# Ice Order Bot

Telegram bot for managing ice orders with Google Sheets integration.

## Features

- Order ice in 5kg increments
- Save delivery addresses
- Select delivery date (today, tomorrow, or specific date)
- Cancel active orders
- Store orders in Google Sheets

## Setup for Railway Deployment

1. Create a new project on Railway
2. Connect your GitHub repository
3. Add the following environment variables in Railway:
   - `BOT_TOKEN` - Your Telegram bot token
   - `SPREADSHEET_ID` - Your Google Sheets ID
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` - Your Google service account email
   - `GOOGLE_PRIVATE_KEY` - Your Google service account private key

### Google Sheets Setup

1. Create a project in Google Cloud Console
2. Enable Google Sheets API
3. Create a service account and download credentials
4. Share your Google Sheet with the service account email
5. Copy the service account email and private key to Railway environment variables

### Local Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create `.env` file with required environment variables
4. Create `credentials.json` with Google service account credentials
5. Run the bot:
   ```bash
   npm run dev
   ```

## Commands

- `/start` - Start the bot
- `/order` - Place a new order
- `/address` - Change delivery address
- `/cancel` - Cancel active orders

## Environment Variables

- `BOT_TOKEN` - Telegram bot token
- `SPREADSHEET_ID` - Google Sheets ID
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` - Google service account email
- `GOOGLE_PRIVATE_KEY` - Google service account private key 