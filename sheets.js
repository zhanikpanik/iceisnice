const { google } = require('googleapis');
const { JWT } = require('google-auth-library');
const fs = require('fs');

// Load credentials from service account file
const credentials = JSON.parse(fs.readFileSync('credentials.json'));

// Create JWT client
const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    subject: credentials.client_email
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