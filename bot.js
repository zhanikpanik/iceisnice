require('dotenv').config();
const { Telegraf, Scenes, session, Markup } = require('telegraf');
const fs = require('fs');
const { initializeSheet, addOrder, cancelOrder, getActiveOrders, getVenueData, sheets, updateVenueAddress, updateTodayOrders } = require('./sheets');
const schedule = require('node-schedule');

// Validate environment variables
const requiredEnvVars = ['BOT_TOKEN', 'SPREADSHEET_ID'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`${envVar} is not defined in .env file`);
        process.exit(1);
    }
}

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// User data management
const userData = {};
try {
    Object.assign(userData, JSON.parse(fs.readFileSync('userData.json', 'utf8')));
} catch (error) {
    console.log('No existing user data found, starting fresh');
}

const saveUserData = () => fs.writeFileSync('userData.json', JSON.stringify(userData, null, 2));

// Keyboards
const keyboards = {
    main: Markup.keyboard([
        ['❄️ Заказать лёд ❄️', '❌ Отменить заказ']
    ]).resize(),

    order: Markup.keyboard([
        ['30 кг', '40 кг', '50 кг'],
        ['60 кг', '70 кг', '80 кг'],
        ['90 кг', '100 кг'],
        ['🔙 Назад']
    ]).resize(),

    date: Markup.keyboard([
        ['📅 На сегодня', '📅 На завтра'],
        ['📅 Выбрать дату', '🔙 Назад']
    ]).resize(),

    back: Markup.keyboard([['🔙 Назад']]).resize()
};

// Scenes
const venueScene = new Scenes.BaseScene('venue');
const addressScene = new Scenes.BaseScene('address');
const orderScene = new Scenes.BaseScene('order');

// Venue scene handlers
venueScene.enter(async (ctx) => {
    await ctx.reply('Введите название заведения:', keyboards.back);
});

venueScene.hears('🔙 Назад', async (ctx) => {
    await ctx.reply('Главное меню:', keyboards.main);
    await ctx.scene.leave();
});

venueScene.hears(/^[^/].+$/, async (ctx) => {
    const { text: venueName, from: { id: userId } } = ctx.message;
    
    if (!userData[userId]) userData[userId] = {};
    userData[userId].venueName = venueName;
    saveUserData();

    await ctx.scene.enter('address');
});

// Address scene handlers
addressScene.enter(async (ctx) => {
    await ctx.reply('Введите адрес заведения:', keyboards.back);
});

addressScene.hears('🔙 Назад', async (ctx) => {
    await ctx.scene.enter('venue');
});

addressScene.hears(/^.+$/, async (ctx) => {
    const { text: address, from: { id: userId } } = ctx.message;
    
    userData[userId] = {
        ...userData[userId],
        address,
        isRegistered: true,
        venueId: userId.toString()
    };
    saveUserData();

    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Заведения!A:D',
            valueInputOption: 'RAW',
            resource: {
                values: [[userData[userId].venueId, userData[userId].venueName, address, 30]]
            }
        });

        await ctx.reply(
            `Отлично! Заведение зарегистрировано:\n\n` +
            `Название: ${userData[userId].venueName}\n` +
            `Адрес: ${address}\n` +
            `Цена за кг: 30 сом\n\n` +
            'Теперь вы можете сделать заказ:',
            keyboards.main
        );
    } catch (error) {
        console.error('Error creating venue:', error);
        await ctx.reply('Произошла ошибка при регистрации заведения. Пожалуйста, попробуйте позже.', keyboards.main);
    }
    
    await ctx.scene.leave();
});

// Order scene handlers
orderScene.enter(async (ctx) => {
    const userId = ctx.from.id;
    
    if (!userData[userId]?.isRegistered) {
        await ctx.reply('Пожалуйста, сначала зарегистрируйте заведение.', keyboards.main);
        await ctx.scene.enter('venue');
        return;
    }

    const venueData = await getVenueData(userData[userId].venueId);
    if (!venueData) {
        await ctx.reply('Ошибка: заведение не найдено. Пожалуйста, зарегистрируйте заведение заново.');
        await ctx.scene.enter('venue');
        return;
    }
    
    await ctx.reply(
        `Заказ для ${venueData.name}\n` +
        `Адрес: ${venueData.address}\n` +
        `Цена: ${venueData.price} сом/кг\n\n` +
        'Выберите количество льда (шаг 10 кг):',
        { reply_markup: keyboards.order.reply_markup }
    );
});

orderScene.hears(/^\d+ кг$/, async (ctx) => {
    const { text, from: { id: userId } } = ctx.message;
    const amount = parseInt(text);
    
    if (!userData[userId]?.venueId) {
        await ctx.reply('Сначала нужно указать название заведения и адрес доставки!');
        await ctx.scene.enter('venue');
        return;
    }

    // Get venue data to get the correct price
    const venueData = await getVenueData(userData[userId].venueId);
    if (!venueData) {
        await ctx.reply('Ошибка: заведение не найдено. Пожалуйста, зарегистрируйте заведение заново.');
        await ctx.scene.enter('venue');
        return;
    }

    const pricePerKg = venueData.price;
    const deliveryFee = 100;
    const subtotal = amount * pricePerKg;
    const totalPrice = subtotal + deliveryFee;

    ctx.scene.state = { amount, pricePerKg, deliveryFee, subtotal, totalPrice };

    await ctx.reply(
        `Выбранное количество: ${amount} кг\n` +
        `Цена: ${pricePerKg} сом/кг\n` +
        `Подытог: ${subtotal} сом\n` +
        `Доставка: ${deliveryFee} сом\n` +
        `Итого с доставкой: ${totalPrice} сом\n\n` +
        'Выберите дату доставки:',
        keyboards.date
    );
});

orderScene.hears('📅 На сегодня', async (ctx) => {
    const userId = ctx.from.id;
    const { amount, pricePerKg, deliveryFee, subtotal, totalPrice } = ctx.scene.state;
    const now = new Date();
    // Convert to UTC+6 (Almaty)
    const almatyTime = new Date(now.getTime() + (6 * 60 * 60 * 1000));
    const currentHour = almatyTime.getUTCHours();
    const currentMinutes = almatyTime.getUTCMinutes();

    console.log('Current time in Almaty:', `${currentHour}:${currentMinutes}`);
    console.log('Is order allowed:', currentHour < 17);

    // Check if current time is before 17:00
    if (currentHour >= 17) {
        console.log('Order rejected - time check failed');
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        await ctx.reply(
            'К сожалению, заказы на сегодня принимаются только до 17:00.\n\n' +
            'Выберите другую дату доставки:\n' +
            `• Завтра (${tomorrow.toLocaleDateString()})\n` +
            '• Выбрать конкретную дату',
            keyboards.date
        );
        return;
    }

    console.log('Order accepted - time check passed');
    const deliveryDate = now.toISOString().split('T')[0];

    const success = await addOrder(
        userId,
        userData[userId].venueId,
        userData[userId].address,
        amount,
        deliveryDate,
        now.toISOString()
    );

    if (success) {
        await ctx.reply(
            `Заказ оформлен!\n\n` +
            `Заведение: ${userData[userId].venueName}\n` +
            `Количество: ${amount} кг\n` +
            `Цена: ${pricePerKg} сом/кг\n` +
            `Подытог: ${subtotal} сом\n` +
            `Доставка: ${deliveryFee} сом\n` +
            `Итого с доставкой: ${totalPrice} сом\n` +
            `Адрес: ${userData[userId].address}\n` +
            `Дата доставки: ${now.toLocaleDateString()}\n\n` +
            `🚚 Водитель выедет в 17:00`,
            keyboards.main
        );
    } else {
        await ctx.reply('Произошла ошибка при сохранении заказа. Пожалуйста, попробуйте позже.');
    }
    
    await ctx.scene.leave();
});

orderScene.hears('📅 На завтра', async (ctx) => {
    const userId = ctx.from.id;
    const { amount, pricePerKg, deliveryFee, subtotal, totalPrice } = ctx.scene.state;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const deliveryDate = tomorrow.toISOString().split('T')[0];

    const success = await addOrder(
        userId,
        userData[userId].venueId,
        userData[userId].address,
        amount,
        deliveryDate,
        new Date().toISOString()
    );

    if (success) {
        await ctx.reply(
            `Заказ оформлен!\n\n` +
            `Заведение: ${userData[userId].venueName}\n` +
            `Количество: ${amount} кг\n` +
            `Цена: ${pricePerKg} сом/кг\n` +
            `Подытог: ${subtotal} сом\n` +
            `Доставка: ${deliveryFee} сом\n` +
            `Итого с доставкой: ${totalPrice} сом\n` +
            `Адрес: ${userData[userId].address}\n` +
            `Дата доставки: ${tomorrow.toLocaleDateString()}`,
            keyboards.main
        );
    } else {
        await ctx.reply('Произошла ошибка при сохранении заказа. Пожалуйста, попробуйте позже.');
    }
    
    await ctx.scene.leave();
});

orderScene.hears('📅 Выбрать дату', async (ctx) => {
    // Generate next 7 days
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() + i);
        dates.push(date);
    }

    // Create keyboard with dates (3 buttons per row)
    const dateButtons = [];
    for (let i = 0; i < dates.length; i += 3) {
        const row = dates.slice(i, i + 3).map(date => {
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            return `📅 ${day}.${month}`;
        });
        dateButtons.push(row);
    }

    // Add "Choose another date" button and back button
    dateButtons.push(['📅 Другая дата']);
    dateButtons.push(['🔙 Назад']);

    const customDateKeyboard = Markup.keyboard(dateButtons).resize();

    await ctx.reply(
        'Выберите дату доставки:',
        customDateKeyboard
    );
});

// Handle specific date buttons
orderScene.hears(/^📅 (\d{2})\.(\d{2})$/, async (ctx) => {
    const userId = ctx.from.id;
    const { amount, pricePerKg, deliveryFee, subtotal, totalPrice } = ctx.scene.state;
    const [, day, month] = ctx.match;
    
    // Get current year
    const year = new Date().getFullYear();
    
    // Create delivery date
    const deliveryDate = new Date(year, parseInt(month) - 1, parseInt(day));
    
    const success = await addOrder(
        userId,
        userData[userId].venueId,
        userData[userId].address,
        amount,
        deliveryDate.toISOString().split('T')[0],
        new Date().toISOString()
    );

    if (success) {
        await ctx.reply(
            `Заказ оформлен!\n\n` +
            `Заведение: ${userData[userId].venueName}\n` +
            `Количество: ${amount} кг\n` +
            `Цена: ${pricePerKg} сом/кг\n` +
            `Подытог: ${subtotal} сом\n` +
            `Доставка: ${deliveryFee} сом\n` +
            `Итого с доставкой: ${totalPrice} сом\n` +
            `Адрес: ${userData[userId].address}\n` +
            `Дата доставки: ${deliveryDate.toLocaleDateString()}`,
            keyboards.main
        );
        await ctx.scene.leave();
    } else {
        await ctx.reply('Произошла ошибка при сохранении заказа. Пожалуйста, попробуйте позже.');
    }
});

// Handle "Choose another date" button
orderScene.hears('📅 Другая дата', async (ctx) => {
    await ctx.reply(
        'Введите дату доставки в формате ДД.ММ.ГГГГ\n' +
        'Например: 25.03.2024',
        keyboards.back
    );
});

// Register scenes
const stage = new Scenes.Stage([venueScene, addressScene, orderScene]);

// Middleware
bot.use(session());
bot.use(stage.middleware());

// Command handlers
bot.command('start', async (ctx) => {
    const { id: userId, username } = ctx.from;
    
    if (!userData[userId]) {
        userData[userId] = {
            username: username || `user${userId}`,
            isRegistered: false
        };
        saveUserData();
    }
    
    if (userData[userId].isRegistered) {
        await ctx.reply(
            `Добро пожаловать в бот заказа льда!\n\n` +
            `Текущие данные:\n` +
            `Заведение: ${userData[userId].venueName}\n` +
            `Адрес: ${userData[userId].address}\n\n` +
            `Что вы хотите сделать?`,
            keyboards.main
        );
    } else {
        await ctx.reply(
            'Добро пожаловать в бот заказа льда!\n\n' +
            'Для начала работы необходимо зарегистрировать заведение.\n' +
            'Пожалуйста, введите название заведения:',
            keyboards.back
        );
        await ctx.scene.enter('venue');
    }
});

// Message handlers
bot.hears('❄️ Заказать лёд ❄️', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!userData[userId]?.isRegistered) {
        await ctx.reply('Пожалуйста, сначала зарегистрируйте заведение.', keyboards.main);
        await ctx.scene.enter('venue');
        return;
    }
    
    await ctx.scene.enter('order');
});

// Handle cancel order
bot.hears('❌ Отменить заказ', async (ctx) => {
    const userId = ctx.from.id;
    const activeOrders = await getActiveOrders(userId);
    
    if (activeOrders.length === 0) {
        await ctx.reply('У вас нет активных заказов.');
        return;
    }

    // Create keyboard with active orders (each order in its own row)
    const keyboard = activeOrders.map(order => [{
        text: `Заказ №${order.index} - ${order.amount} кг (${order.deliveryDate})`
    }]);
    
    // Add back button
    keyboard.push([{ text: '🔙 Назад' }]);

    await ctx.reply('Выберите заказ для отмены:', {
        reply_markup: {
            keyboard: keyboard,
            resize_keyboard: true
        }
    });
});

// Handle back button in cancel order menu
bot.hears('🔙 Назад', async (ctx) => {
    await ctx.reply('Главное меню:', keyboards.main);
});

// Test commands for debugging (ADMIN ONLY)
const ADMIN_IDS = ['532746965']; // Add your Telegram ID here

const isAdmin = (userId) => ADMIN_IDS.includes(userId.toString());

bot.command('test_orders', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        await ctx.reply('⛔️ У вас нет доступа к этой команде');
        return;
    }

    console.log('Creating test orders...');
    const userId = ctx.from.id;
    
    try {
        // Create order for today
        const today = new Date();
        console.log('Creating order for today:', today.toISOString().split('T')[0]);
        await addOrder(
            userId,
            userId.toString(),
            'Test Address 1',
            50,
            today.toISOString().split('T')[0],
            new Date().toISOString()
        );

        // Create order for tomorrow
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        console.log('Creating order for tomorrow:', tomorrow.toISOString().split('T')[0]);
        await addOrder(
            userId,
            userId.toString(),
            'Test Address 2',
            70,
            tomorrow.toISOString().split('T')[0],
            new Date().toISOString()
        );

        // Create order for day after tomorrow
        const dayAfterTomorrow = new Date();
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
        console.log('Creating order for day after tomorrow:', dayAfterTomorrow.toISOString().split('T')[0]);
        await addOrder(
            userId,
            userId.toString(),
            'Test Address 3',
            90,
            dayAfterTomorrow.toISOString().split('T')[0],
            new Date().toISOString()
        );

        await ctx.reply(
            '✅ Тестовые заказы созданы:\n' +
            `1. На сегодня (${today.toISOString().split('T')[0]}) - 50 кг\n` +
            `2. На завтра (${tomorrow.toISOString().split('T')[0]}) - 70 кг\n` +
            `3. На послезавтра (${dayAfterTomorrow.toISOString().split('T')[0]}) - 90 кг\n\n` +
            'Используйте команду /check_state чтобы проверить состояние заказов.'
        );
        console.log('Test orders created successfully');
    } catch (error) {
        console.error('Error creating test orders:', error);
        await ctx.reply('❌ Ошибка при создании тестовых заказов');
    }
});

bot.command('check_state', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        await ctx.reply('⛔️ У вас нет доступа к этой команде');
        return;
    }

    console.log('Checking system state...');
    try {
        // Get orders from Archive
        const archiveResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Архив!A:I'
        });

        // Get orders from Orders
        const ordersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Заказы!A:I'
        });

        const today = new Date().toISOString().split('T')[0];
        
        const archiveRows = archiveResponse.data.values || [];
        const ordersRows = ordersResponse.data.values || [];
        
        // Count orders by status and date
        const stats = {
            archive: {
                total: archiveRows.length - 1,
                active: 0,
                canceled: 0,
                future: 0
            },
            orders: {
                total: ordersRows.length - 1,
                active: 0,
                canceled: 0
            }
        };

        // Process Archive orders
        archiveRows.slice(1).forEach(row => {
            if (row[6] === 'Новый') {
                stats.archive.active++;
                if (row[4] > today) {
                    stats.archive.future++;
                }
            } else if (row[6] === 'Отменен') {
                stats.archive.canceled++;
            }
        });

        // Process Orders
        ordersRows.slice(1).forEach(row => {
            if (row[6] === 'Новый') {
                stats.orders.active++;
            } else if (row[6] === 'Отменен') {
                stats.orders.canceled++;
            }
        });

        await ctx.reply(
            '📊 Состояние системы:\n\n' +
            '📁 Архив заказов:\n' +
            `• Всего заказов: ${stats.archive.total}\n` +
            `• Активных: ${stats.archive.active}\n` +
            `• Отмененных: ${stats.archive.canceled}\n` +
            `• Будущих: ${stats.archive.future}\n\n` +
            '📋 Заказы на сегодня:\n' +
            `• Всего заказов: ${stats.orders.total}\n` +
            `• Активных: ${stats.orders.active}\n` +
            `• Отмененных: ${stats.orders.canceled}\n\n` +
            `Текущая дата: ${today}`
        );
        
        console.log('System state checked successfully', stats);
    } catch (error) {
        console.error('Error checking system state:', error);
        await ctx.reply('❌ Ошибка при проверке состояния системы');
    }
});

bot.command('update_orders', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        await ctx.reply('⛔️ У вас нет доступа к этой команде');
        return;
    }

    console.log('Manual update triggered by user:', ctx.from.id);
    try {
        await updateTodayOrders();
        await ctx.reply('✅ Обновление заказов выполнено успешно!');
        console.log('Manual update completed successfully');
    } catch (error) {
        console.error('Error updating orders:', error);
        await ctx.reply('❌ Ошибка при обновлении заказов');
    }
});

// Debug handler for all text messages
bot.on('text', (ctx) => {
    // Only log if we're not in a scene and it's not a command
    if (!ctx.scene.current && !ctx.message.text.startsWith('/')) {
        console.log('Received text message (DEBUG):', ctx.message.text);
        console.log('Message type (DEBUG):', ctx.message.text);
        console.log('User ID (DEBUG):', ctx.from.id);
    }
});

// Order command
bot.command('order', async (ctx) => {
    await ctx.scene.enter('order');
});

// Address command
bot.command('address', async (ctx) => {
    await ctx.scene.enter('venue');
});

// Update main menu handler
bot.hears('📍 Изменить адрес', async (ctx) => {
    console.log('Address change button pressed');
    await ctx.scene.enter('address');
});

// Error handling
bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}:`, err);
});

// Start bot
async function startBot() {
    try {
        await initializeSheet();

        schedule.scheduleJob('0 0 * * *', async () => {
            try {
                await updateTodayOrders();
                console.log('Daily orders update completed');
            } catch (error) {
                console.error('Error in daily orders update:', error);
            }
        });

        await updateTodayOrders();
        await bot.launch();
        console.log('Bot started');
    } catch (error) {
        console.error('Error starting bot:', error);
        process.exit(1);
    }
}

startBot();

// Graceful shutdown
process.once('SIGINT', () => {
    schedule.gracefulShutdown()
        .then(() => bot.stop('SIGINT'));
});
process.once('SIGTERM', () => {
    schedule.gracefulShutdown()
        .then(() => bot.stop('SIGTERM'));
});