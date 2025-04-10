require('dotenv').config();
const { google } = require('googleapis');

// Initialize Google Sheets API
const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
);

const sheets = google.sheets({ version: 'v4', auth });

// Initialize sheet with required columns
async function initializeSheet() {
    try {
        // Check if sheets exist
        const sheetsList = await sheets.spreadsheets.get({
            spreadsheetId: process.env.SPREADSHEET_ID
        });

        const sheetTitles = sheetsList.data.sheets.map(sheet => sheet.properties.title);
        const requiredSheets = ['Заведения', 'Заказы', 'Архив'];

        // Create missing sheets
        for (const title of requiredSheets) {
            if (!sheetTitles.includes(title)) {
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    resource: {
                        requests: [{
                            addSheet: {
                                properties: { title }
                            }
                        }]
                    }
                });

                // Add headers to new sheet
                const headers = title === 'Заведения' 
                    ? ['ID', 'Название', 'Адрес', 'Цена за кг']
                    : title === 'Заказы'
                        ? ['Название заведения', 'Адрес', 'Количество (кг)', 'Сумма за лёд']
                        : ['ID', 'ID заведения', 'Адрес', 'Количество', 'Дата доставки', 'Дата создания', 'Статус', 'Цена за кг', 'Итого'];

                await sheets.spreadsheets.values.update({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: `${title}!A1:${String.fromCharCode(65 + headers.length - 1)}1`,
                    valueInputOption: 'RAW',
                    resource: { values: [headers] }
                });
            }
        }
    } catch (error) {
        console.error('Error initializing sheet:', error);
        throw error;
    }
}

// Get venue data by ID
async function getVenueData(venueId) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Заведения!A:D'
        });

        const rows = response.data.values;
        if (!rows || rows.length < 2) return null;

        const venueRow = rows.find(row => row[0] === venueId);
        if (!venueRow) return null;

        return {
            id: venueRow[0],
            name: venueRow[1],
            address: venueRow[2],
            price: parseInt(venueRow[3])
        };
    } catch (error) {
        console.error('Error getting venue data:', error);
        return null;
    }
}

// Add new order
async function addOrder(userId, venueId, address, amount, deliveryDate, createdAt) {
    try {
        const venueData = await getVenueData(venueId);
        if (!venueData) return false;

        const pricePerKg = venueData.price;
        const totalPrice = amount * pricePerKg;

        // Add to Archive sheet
        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Архив!A:I',
            valueInputOption: 'RAW',
            resource: {
                values: [[
                    userId,
                    venueId,
                    address,
                    amount,
                    deliveryDate,
                    createdAt,
                    'Новый',
                    pricePerKg,
                    totalPrice
                ]]
            }
        });

        // If order is for today, add to Orders sheet
        const today = new Date().toISOString().split('T')[0];
        if (deliveryDate === today) {
            await sheets.spreadsheets.values.append({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: 'Заказы!A:I',
                valueInputOption: 'RAW',
                resource: {
                    values: [[
                        userId,
                        venueId,
                        address,
                        amount,
                        deliveryDate,
                        createdAt,
                        'Новый',
                        pricePerKg,
                        totalPrice
                    ]]
                }
            });
        }

        return true;
    } catch (error) {
        console.error('Error adding order:', error);
        return false;
    }
}

// Get active orders for user
async function getActiveOrders(userId) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Заказы!A:I'
        });

        const rows = response.data.values;
        if (!rows || rows.length < 2) return [];

        return rows.slice(1)
            .filter(row => row[0] === userId.toString() && row[6] === 'Новый')
            .map((row, index) => ({
                index: index + 1,
                amount: parseInt(row[3]),
                deliveryDate: row[4],
                pricePerKg: parseInt(row[7]),
                totalPrice: parseInt(row[8])
            }));
    } catch (error) {
        console.error('Error getting active orders:', error);
        return [];
    }
}

// Cancel order
async function cancelOrder(userId, orderIndex) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Заказы!A:I'
        });

        const rows = response.data.values;
        if (!rows || rows.length < 2) return false;

        const userOrders = rows.slice(1)
            .filter(row => row[0] === userId.toString() && row[6] === 'Новый');

        if (orderIndex < 1 || orderIndex > userOrders.length) return false;

        const orderToCancel = userOrders[orderIndex - 1];
        const rowIndex = rows.findIndex(row => 
            row[0] === userId.toString() && 
            row[3] === orderToCancel[3] && 
            row[4] === orderToCancel[4] && 
            row[6] === 'Новый'
        );

        if (rowIndex === -1) return false;

        // Update status to 'Отменен'
        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `Заказы!G${rowIndex + 1}`,
            valueInputOption: 'RAW',
            resource: { values: [['Отменен']] }
        });

        // Update row color to red
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: process.env.SPREADSHEET_ID,
            resource: {
                requests: [{
                    repeatCell: {
                        range: {
                            sheetId: 1, // Заказы sheet
                            startRowIndex: rowIndex,
                            endRowIndex: rowIndex + 1,
                            startColumnIndex: 0,
                            endColumnIndex: 9
                        },
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: {
                                    red: 1,
                                    green: 0,
                                    blue: 0
                                }
                            }
                        },
                        fields: 'userEnteredFormat.backgroundColor'
                    }
                }]
            }
        });

        return true;
    } catch (error) {
        console.error('Error canceling order:', error);
        return false;
    }
}

// Update today's orders
async function updateTodayOrders() {
    try {
        const today = new Date().toISOString().split('T')[0];
        console.log(`Starting daily update for ${today}`);
        
        // Get all orders from Archive
        console.log('Fetching orders from Archive...');
        const archiveResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Архив!A:I'
        });

        const archiveRows = archiveResponse.data.values;
        if (!archiveRows || archiveRows.length < 2) {
            console.log('No orders found in Archive');
            return;
        }

        // Filter today's orders
        console.log('Filtering orders for today...');
        const todayOrders = archiveRows.slice(1)
            .filter(row => row[4] === today && row[6] === 'Новый');

        console.log(`Found ${todayOrders.length} orders for today`);

        // Clear Orders sheet
        console.log('Clearing Orders sheet...');
        await sheets.spreadsheets.values.clear({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Заказы!A:D'
        });

        // Add headers back
        console.log('Adding headers to Orders sheet...');
        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Заказы!A1:D1',
            valueInputOption: 'RAW',
            resource: {
                values: [['Название заведения', 'Адрес', 'Количество (кг)', 'Сумма за лёд']]
            }
        });

        // Add today's orders in simplified format
        if (todayOrders.length > 0) {
            console.log('Adding today\'s orders to Orders sheet...');
            
            // Transform orders to new format
            const simplifiedOrders = await Promise.all(todayOrders.map(async (order) => {
                const venueData = await getVenueData(order[1]); // Get venue data using venueId
                const amount = parseInt(order[3]);
                const pricePerKg = venueData.price;
                const icePrice = amount * pricePerKg; // Only ice price without delivery

                return [
                    venueData.name,    // Название заведения
                    venueData.address, // Адрес
                    amount,           // Количество
                    icePrice         // Сумма за лёд (без доставки)
                ];
            }));

            await sheets.spreadsheets.values.append({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: 'Заказы!A:D',
                valueInputOption: 'RAW',
                resource: { values: simplifiedOrders }
            });

            // Log order details
            simplifiedOrders.forEach((order, index) => {
                console.log(`Order ${index + 1}:`, {
                    venueName: order[0],
                    address: order[1],
                    amount: order[2],
                    icePrice: order[3]
                });
            });
        }

        console.log('Daily update completed successfully');
    } catch (error) {
        console.error('Error updating today orders:', error);
        throw error;
    }
}

module.exports = {
    initializeSheet,
    addOrder,
    cancelOrder,
    getActiveOrders,
    getVenueData,
    updateTodayOrders,
    sheets
};
