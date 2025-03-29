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
        console.log('Starting sheet initialization...');
        
        // Get spreadsheet details
        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID
        });
        
        // Check if sheets exist
        const sheetTitles = spreadsheet.data.sheets.map(sheet => sheet.properties.title);
        const needsOrdersSheet = !sheetTitles.includes('Заказы');
        const needsArchiveSheet = !sheetTitles.includes('Архив');
        
        // Create sheets if they don't exist
        if (needsOrdersSheet || needsArchiveSheet) {
            const requests = [];
            
            if (needsOrdersSheet) {
                requests.push({
                    addSheet: {
                        properties: {
                            title: 'Заказы'
                        }
                    }
                });
            }
            
            if (needsArchiveSheet) {
                requests.push({
                    addSheet: {
                        properties: {
                            title: 'Архив'
                        }
                    }
                });
            }
            
            if (requests.length > 0) {
                console.log('Creating new sheets...');
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: {
                        requests: requests
                    }
                });
            }
        }
        
        // Get updated spreadsheet details to get correct sheet IDs
        const updatedSpreadsheet = await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID
        });
        
        // Get sheet IDs
        const ordersSheetId = updatedSpreadsheet.data.sheets.find(sheet => sheet.properties.title === 'Заказы').properties.sheetId;
        const archiveSheetId = updatedSpreadsheet.data.sheets.find(sheet => sheet.properties.title === 'Архив').properties.sheetId;
        
        // Initialize main sheet for current orders
        const mainHeaders = [['№', 'Заведение', 'Адрес', 'Количество (кг)', 'Время заказа', 'Статус']];
        console.log('Updating main sheet headers...');
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Заказы!A1:F1',
            valueInputOption: 'RAW',
            resource: { values: mainHeaders }
        });

        // Initialize archive sheet for accounting
        const archiveHeaders = [['Дата заказа', 'Дата доставки', 'Заведение', 'Адрес', 'Количество (кг)', 'Статус']];
        console.log('Updating archive sheet headers...');
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Архив!A1:F1',
            valueInputOption: 'RAW',
            resource: { values: archiveHeaders }
        });

        // Format headers
        console.log('Formatting headers...');
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                requests: [
                    {
                        repeatCell: {
                            range: {
                                sheetId: ordersSheetId,
                                startRowIndex: 0,
                                endRowIndex: 1,
                                startColumnIndex: 0,
                                endColumnIndex: 6
                            },
                            cell: {
                                userEnteredFormat: {
                                    backgroundColor: { red: 0.8, green: 0.8, blue: 0.8 },
                                    textFormat: { bold: true },
                                    horizontalAlignment: "CENTER"
                                }
                            },
                            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
                        }
                    },
                    {
                        repeatCell: {
                            range: {
                                sheetId: archiveSheetId,
                                startRowIndex: 0,
                                endRowIndex: 1,
                                startColumnIndex: 0,
                                endColumnIndex: 6
                            },
                            cell: {
                                userEnteredFormat: {
                                    backgroundColor: { red: 0.8, green: 0.8, blue: 0.8 },
                                    textFormat: { bold: true },
                                    horizontalAlignment: "CENTER"
                                }
                            },
                            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
                        }
                    }
                ]
            }
        });

        console.log('Sheets initialized successfully');
    } catch (error) {
        console.error('Error initializing sheets:', error);
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

// Helper functions for data normalization
function normalizeString(str) {
    return str
        .toLowerCase()
        .replace(/[ё]/g, 'е')
        .replace(/[^а-яёa-z0-9]/g, '')
        .trim();
}

function normalizeAddress(addr) {
    return addr
        .toLowerCase()
        .replace(/[ё]/g, 'е')
        .replace(/[^а-яёa-z0-9]/g, '')
        .replace(/\s+/g, '')
        .trim();
}

// Add a new order to the sheet
async function addOrder(userId, venueName, address, amount, deliveryDate, timestamp) {
    try {
        // Get current orders to determine the next order number
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Заказы!A:N'
        });

        const rows = response.data.values || [];
        const nextOrderNumber = rows.length; // Next row number (including header)

        // Normalize venue name and address
        const normalizedVenueName = normalizeString(venueName);
        const normalizedAddress = normalizeAddress(address);

        // Add to main sheet (for courier)
        const mainValues = [[
            nextOrderNumber, // Order number
            venueName, // Original venue name for display
            address, // Original address for display
            amount,
            new Date(timestamp).toLocaleTimeString(), // Format time for better readability
            'Активен'
        ]];

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `Заказы!A${nextOrderNumber + 1}:F${nextOrderNumber + 1}`,
            valueInputOption: 'RAW',
            resource: { values: mainValues }
        });

        // Add to archive sheet (for accounting)
        const archiveValues = [[
            new Date(timestamp).toLocaleDateString(), // Order date
            deliveryDate,
            venueName, // Original venue name
            address, // Original address
            amount,
            'Активен'
        ]];

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Архив!A:F',
            valueInputOption: 'RAW',
            resource: { values: archiveValues }
        });

        // Store full order data in hidden columns
        const fullOrderData = [[
            userId,
            venueName, // Original venue name
            address, // Original address
            normalizedVenueName, // Normalized venue name for matching
            normalizedAddress, // Normalized address for matching
            amount,
            deliveryDate,
            timestamp,
            'Активен'
        ]];

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `Заказы!H${nextOrderNumber + 1}:P${nextOrderNumber + 1}`,
            valueInputOption: 'RAW',
            resource: { values: fullOrderData }
        });

        console.log('Order added successfully');
        return true;
    } catch (error) {
        console.error('Error adding order:', error);
        return false;
    }
}

// Get active orders for a user
async function getActiveOrders(userId) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Заказы!A:P'
        });

        const rows = response.data.values;
        const userOrders = [];
        let currentIndex = 0;

        // Filter active orders and sort by delivery date
        const activeOrders = rows.slice(1) // Skip header row
            .filter(row => row[7] === userId.toString() && row[8] === 'Активен')
            .sort((a, b) => new Date(a[10]) - new Date(b[10])); // Sort by delivery date

        // Add orders with new indices
        activeOrders.forEach(order => {
            currentIndex++;
            userOrders.push({
                index: currentIndex,
                amount: parseInt(order[5]),
                deliveryDate: order[10]
            });
        });

        return userOrders;
    } catch (error) {
        console.error('Error getting active orders:', error);
        return [];
    }
}

// Cancel an order by updating its status
async function cancelOrder(userId, orderIndex) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Заказы!A:P'
        });

        const rows = response.data.values;
        let currentIndex = 0;
        let targetRow = -1;

        // Find the order by userId and index
        for (let i = 1; i < rows.length; i++) {
            if (rows[i][7] === userId.toString() && rows[i][8] === 'Активен') {
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

        // Update status in main sheet
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `Заказы!F${targetRow}`,
            valueInputOption: 'RAW',
            resource: {
                values: [['Отменен']]
            }
        });

        // Update status in archive sheet
        const orderData = rows[targetRow - 1];
        const archiveResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Архив!A:F'
        });

        const archiveRows = archiveResponse.data.values;
        for (let i = 1; i < archiveRows.length; i++) {
            if (archiveRows[i][2] === orderData[1] && // venueName
                archiveRows[i][3] === orderData[2] && // address
                archiveRows[i][4] === orderData[5] && // amount
                archiveRows[i][5] === 'Активен') {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `Архив!F${i + 1}`,
                    valueInputOption: 'RAW',
                    resource: {
                        values: [['Отменен']]
                    }
                });
                break;
            }
        }

        console.log('Order cancelled successfully');
        return true;
    } catch (error) {
        console.error('Error cancelling order:', error);
        return false;
    }
}

module.exports = {
    initializeSheet,
    addOrder,
    cancelOrder,
    getActiveOrders
};
