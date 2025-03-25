require('dotenv').config();
const { Telegraf, Scenes, session, Markup } = require('telegraf');
const fs = require('fs');
const { initializeSheet, addOrder, cancelOrder, getActiveOrders } = require('./sheets');

// Check if bot token exists
if (!process.env.BOT_TOKEN) {
    console.error('BOT_TOKEN is not defined in .env file');
    process.exit(1);
}

// Check if spreadsheet ID exists
if (!process.env.SPREADSHEET_ID) {
    console.error('SPREADSHEET_ID is not defined in .env file');
    process.exit(1);
}

// Initialize bot with your token
const bot = new Telegraf(process.env.BOT_TOKEN);

// User data storage
let userData = {};

// Load user data from file if exists
try {
    userData = JSON.parse(fs.readFileSync('userData.json', 'utf8'));
} catch (error) {
    console.log('No existing user data found, starting fresh');
}

// Save user data to file
function saveUserData() {
    fs.writeFileSync('userData.json', JSON.stringify(userData, null, 2));
}

// Create keyboards
const mainKeyboard = Markup.keyboard([
    ['📝 Сделать заказ', '📍 Изменить адрес'],
    ['❌ Отменить заказ']
]).resize();

const orderKeyboard = Markup.keyboard([
    ['20 кг', '30 кг', '40 кг'],
    ['50 кг', '60 кг', '70 кг'],
    ['80 кг', '90 кг', '100 кг'],
    ['🔙 Назад']
]).resize();

const dateKeyboard = Markup.keyboard([
    ['📅 На сегодня', '📅 На завтра'],
    ['📅 Выбрать дату', '🔙 Назад']
]).resize();

// Scene for collecting venue name
const venueScene = new Scenes.BaseScene('venue');
venueScene.enter((ctx) => {
    ctx.reply(
        'Для оформления заказа необходимо указать данные о заведении.\n\n' +
        'Пожалуйста, введите название заведения:',
        Markup.removeKeyboard()
    );
});

venueScene.on('text', async (ctx) => {
    const userId = ctx.from.id;
    userData[userId] = {
        ...userData[userId],
        venueName: ctx.message.text
    };
    saveUserData();
    await ctx.reply(
        `Название заведения "${ctx.message.text}" сохранено.\n\n` +
        'Теперь введите адрес доставки:'
    );
    await ctx.scene.enter('address');
});

// Scene for collecting address
const addressScene = new Scenes.BaseScene('address');
addressScene.enter((ctx) => {
    ctx.reply('Пожалуйста, введите адрес доставки:');
});

addressScene.on('text', async (ctx) => {
    const userId = ctx.from.id;
    userData[userId] = {
        ...userData[userId],
        address: ctx.message.text
    };
    saveUserData();
    
    await ctx.reply(
        `Отлично! Все данные сохранены:\n\n` +
        `Заведение: ${userData[userId].venueName}\n` +
        `Адрес: ${userData[userId].address}\n\n` +
        'Теперь вы можете сделать заказ:',
        mainKeyboard
    );
    await ctx.scene.leave();
});

// Scene for collecting order details
const orderScene = new Scenes.BaseScene('order');
orderScene.enter((ctx) => {
    ctx.reply('Выберите количество льда (шаг 5 кг):', orderKeyboard);
});

orderScene.hears(/^\d+ кг$/, async (ctx) => {
    const amount = parseInt(ctx.message.text);
    const userId = ctx.from.id;
    
    if (!userData[userId]?.venueName || !userData[userId]?.address) {
        await ctx.reply('Сначала нужно указать название заведения и адрес доставки!');
        await ctx.scene.enter('venue');
        return;
    }

    // Store amount in session
    ctx.scene.state.amount = amount;
    await ctx.reply('Выберите дату доставки:', dateKeyboard);
});

orderScene.hears('📅 На сегодня', async (ctx) => {
    const userId = ctx.from.id;
    const amount = ctx.scene.state.amount;
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinutes = now.getMinutes();

    // Check if current time is before 17:00
    if (currentHour >= 17) {
        await ctx.reply(
            'К сожалению, заказы на сегодня принимаются только до 17:00.\n' +
            'Пожалуйста, выберите другую дату доставки.',
            orderKeyboard
        );
        return;
    }

    const deliveryDate = now.toISOString().split('T')[0];

    const success = await addOrder(
        userId,
        userData[userId].venueName,
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
            `Адрес: ${userData[userId].address}\n` +
            `Дата доставки: ${now.toLocaleDateString()}`,
            mainKeyboard
        );
    } else {
        await ctx.reply('Произошла ошибка при сохранении заказа. Пожалуйста, попробуйте позже.');
    }
    
    await ctx.scene.leave();
});

orderScene.hears('📅 На завтра', async (ctx) => {
    const userId = ctx.from.id;
    const amount = ctx.scene.state.amount;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const deliveryDate = tomorrow.toISOString().split('T')[0];

    const success = await addOrder(
        userId,
        userData[userId].venueName,
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
            `Адрес: ${userData[userId].address}\n` +
            `Дата доставки: ${tomorrow.toLocaleDateString()}`,
            mainKeyboard
        );
    } else {
        await ctx.reply('Произошла ошибка при сохранении заказа. Пожалуйста, попробуйте позже.');
    }
    
    await ctx.scene.leave();
});

orderScene.hears('📅 Выбрать дату', async (ctx) => {
    await ctx.reply(
        'Введите дату доставки в формате ДД.ММ.ГГГГ\n' +
        'Например: 25.03.2024',
        Markup.removeKeyboard()
    );
});

orderScene.hears(/^(\d{2})\.(\d{2})\.(\d{4})$/, async (ctx) => {
    const userId = ctx.from.id;
    const amount = ctx.scene.state.amount;
    const [, day, month, year] = ctx.match;
    
    // Validate date
    const deliveryDate = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (deliveryDate < today) {
        await ctx.reply('Нельзя выбрать прошедшую дату. Пожалуйста, выберите другую дату.');
        return;
    }

    const success = await addOrder(
        userId,
        userData[userId].venueName,
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
            `Адрес: ${userData[userId].address}\n` +
            `Дата доставки: ${deliveryDate.toLocaleDateString()}`,
            mainKeyboard
        );
    } else {
        await ctx.reply('Произошла ошибка при сохранении заказа. Пожалуйста, попробуйте позже.');
    }
    
    await ctx.scene.leave();
});

orderScene.hears('🔙 Назад', async (ctx) => {
    await ctx.reply('Главное меню:', mainKeyboard);
    await ctx.scene.leave();
});

// Register scenes
const stage = new Scenes.Stage([venueScene, addressScene, orderScene]);
bot.use(session());
bot.use(stage.middleware());

// Start command
bot.command('start', async (ctx) => {
    const userId = ctx.from.id;
    if (userData[userId]?.venueName && userData[userId]?.address) {
        await ctx.reply(
            `Добро пожаловать в бот заказа льда!\n\n` +
            `Текущие данные:\n` +
            `Заведение: ${userData[userId].venueName}\n` +
            `Адрес: ${userData[userId].address}\n\n` +
            `Что вы хотите сделать?`,
            mainKeyboard
        );
    } else {
        await ctx.reply('Добро пожаловать в бот заказа льда! Для начала работы необходимо указать данные о заведении.');
        await ctx.scene.enter('venue');
    }
});

// Handle main menu actions
bot.hears('📝 Сделать заказ', async (ctx) => {
    await ctx.scene.enter('order');
});

bot.hears('📍 Изменить адрес', async (ctx) => {
    await ctx.scene.enter('venue');
});

// Handle order cancellation
bot.hears('❌ Отменить заказ', async (ctx) => {
    const userId = ctx.from.id;
    const activeOrders = await getActiveOrders(userId);

    if (activeOrders.length === 0) {
        await ctx.reply('У вас нет активных заказов.');
        return;
    }

    const keyboard = Markup.keyboard(
        activeOrders.map(order => [`Отменить заказ №${order.index}: ${order.amount} кг`])
    ).resize();

    await ctx.reply('Выберите заказ для отмены:', keyboard);
});

// Handle order cancellation selection
bot.hears(/^Отменить заказ №(\d+): (\d+) кг$/, async (ctx) => {
    const userId = ctx.from.id;
    const orderIndex = parseInt(ctx.match[1]);
    
    const success = await cancelOrder(userId, orderIndex);
    
    if (success) {
        await ctx.reply('Заказ успешно отменен.', mainKeyboard);
    } else {
        await ctx.reply('Произошла ошибка при отмене заказа. Пожалуйста, попробуйте позже.', mainKeyboard);
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

// Error handling
bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}:`, err);
});

// Initialize Google Sheet and start the bot
async function startBot() {
    try {
        await initializeSheet();
        await bot.launch();
        console.log('Bot started');
    } catch (error) {
        console.error('Error starting bot:', error);
        process.exit(1);
    }
}

startBot();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 