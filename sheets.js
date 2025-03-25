const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

// Check if required environment variables are set
if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    console.error('GOOGLE_SERVICE_ACCOUNT_EMAIL is not defined in environment variables');
    process.exit(1);
}

if (!process.env.GOOGLE_PRIVATE_KEY) {
    console.error('GOOGLE_PRIVATE_KEY is not defined in environment variables');
    process.exit(1);
}

if (!process.env.SPREADSHEET_ID) {
    console.error('SPREADSHEET_ID is not defined in environment variables');
    process.exit(1);
}

// Create JWT client using environment variables
const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    subject: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
});

// Create Google Sheets API client
const sheets = google.sheets({ version: 'v4', auth });

// Spreadsheet ID from .env file
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Initialize the sheet with headers if it's empty
async function initializeSheet() {
    try {
        const headers = [['ID пользователя', 'Название заведения', 'Адрес', 'Количество (кг)', 'Дата доставки', 'Время заказа', 'Статус']];
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: 'A1:G1',
            valueInputOption: 'RAW',
            resource: { values: headers }
        });
        console.log('Sheet initialized successfully');
    } catch (error) {
        console.error('Error initializing sheet:', error);
        throw error;
    }
}

// Add a new order to the sheet
async function addOrder(userId, venueName, address, amount, deliveryDate, timestamp) {
    try {
        const values = [[
            userId,
            venueName,
            address,
            amount,
            deliveryDate,
            timestamp,
            'Активен'
        ]];

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'A:G',
            valueInputOption: 'RAW',
            resource: { values }
        });

        console.log('Order added successfully');
        return true;
    } catch (error) {
        console.error('Error adding order:', error);
        return false;
    }
}

// Cancel an order by updating its status
async function cancelOrder(userId, orderIndex) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'A:G'
        });

        const rows = response.data.values;
        let currentIndex = 0;
        let targetRow = -1;

        // Find the order by userId and index
        for (let i = 1; i < rows.length; i++) {
            if (rows[i][0] === userId.toString()) {
                currentIndex++;
                if (currentIndex === orderIndex) {
                    targetRow = i + 1; // +1 because sheets is 1-based
                    break;
                }
            }
        }

        if (targetRow === -1) {
            console.error('Order not found');
            return false;
        }

        // Update the status to 'Отменен'
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `G${targetRow}`,
            valueInputOption: 'RAW',
            resource: {
                values: [['Отменен']]
            }
        });

        console.log('Order cancelled successfully');
        return true;
    } catch (error) {
        console.error('Error cancelling order:', error);
        return false;
    }
}

// Get active orders for a user
async function getActiveOrders(userId) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'A:G'
        });

        const rows = response.data.values;
        const userOrders = [];
        let currentIndex = 0;

        for (let i = 1; i < rows.length; i++) {
            if (rows[i][0] === userId.toString() && rows[i][6] === 'Активен') {
                currentIndex++;
                userOrders.push({
                    index: currentIndex,
                    amount: parseInt(rows[i][3]),
                    deliveryDate: rows[i][4]
                });
            }
        }

        return userOrders;
    } catch (error) {
        console.error('Error getting active orders:', error);
        return [];
    }
}

module.exports = {
    initializeSheet,
    addOrder,
    cancelOrder,
    getActiveOrders
};
