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

// Create a new sheet for a specific date
async function createDailySheet(date) {
    try {
        const sheetTitle = date.toISOString().split('T')[0];
        
        // Check if sheet already exists
        const sheetsList = await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID
        });
        
        const sheetExists = sheetsList.data.sheets.some(sheet => sheet.properties.title === sheetTitle);
        
        if (!sheetExists) {
            // Create new sheet
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    requests: [{
                        addSheet: {
                            properties: {
                                title: sheetTitle
                            }
                        }
                    }]
                }
            });

            // Add headers to new sheet
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetTitle}!A1:G1`,
                valueInputOption: 'RAW',
                resource: {
                    values: [['ID пользователя', 'Название заведения', 'Адрес', 'Количество (кг)', 'Дата доставки', 'Время заказа', 'Статус']]
                }
            });

            console.log(`Created new sheet for ${sheetTitle}`);
        }
        
        return sheetTitle;
    } catch (error) {
        console.error('Error creating daily sheet:', error);
        throw error;
    }
}

// Add a new order to the sheet
async function addOrder(userId, venueName, address, amount, deliveryDate, timestamp) {
    try {
        // Create or get sheet for the delivery date
        const sheetTitle = await createDailySheet(new Date(deliveryDate));
        
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
            range: `${sheetTitle}!A:G`,
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
        // Get all sheets
        const sheetsList = await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID
        });

        // Search through all sheets for the order
        for (const sheet of sheetsList.data.sheets) {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheet.properties.title}!A:G`
            });

            const rows = response.data.values;
            let currentIndex = 0;
            let targetRow = -1;

            // Find the order by userId and index
            for (let i = 1; i < rows.length; i++) {
                if (rows[i][0] === userId.toString() && rows[i][6] === 'Активен') {
                    currentIndex++;
                    if (currentIndex === orderIndex) {
                        targetRow = i + 1; // +1 because sheets is 1-based
                        break;
                    }
                }
            }

            if (targetRow !== -1) {
                // Update the status to 'Отменен'
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${sheet.properties.title}!G${targetRow}`,
                    valueInputOption: 'RAW',
                    resource: {
                        values: [['Отменен']]
                    }
                });

                console.log('Order cancelled successfully');
                return true;
            }
        }

        console.error('Order not found');
        return false;
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

        // Filter active orders and sort by delivery date
        const activeOrders = rows.slice(1) // Skip header row
            .filter(row => row[0] === userId.toString() && row[6] === 'Активен')
            .sort((a, b) => new Date(a[4]) - new Date(b[4])); // Sort by delivery date

        // Add orders with new indices
        activeOrders.forEach(order => {
            currentIndex++;
            userOrders.push({
                index: currentIndex,
                amount: parseInt(order[3]),
                deliveryDate: order[4]
            });
        });

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
