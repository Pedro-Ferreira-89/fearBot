//require('dotenv').config();
const TelegramBot = require("node-telegram-bot-api");
const sqlite3 = require("sqlite3").verbose();
const axios = require("axios");
const Web3 = require("web3");
const ethers = require('ethers')
const {eth} = require("web3");
const artifact =require("./artifacts/token.js").artifact;
const artifact2 =require("./artifacts/router.js").artifact;
const crypto = require('crypto');
// ======================================================
// CONFIG
// ======================================================
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });
const baseProvider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
const API = "https://api.coingecko.com/api/v3";
const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // Example Sepolia
const CBBTC_ADDRESS = "0x4200000000000000000000000000000000000006"
const SWAP_ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
const ALGORITHM = 'aes-256-gcm';
const KEY = crypto.randomBytes(32); // Store this securely (env or SOPS)
const IV_LENGTH = 16; // AES block size

// In-memory session state
const sessions = {};

//const web3 = new Web3("https://mainnet.infura.io/v3/YOUR_INFURA_KEY");

// ======================================================
// SQLITE INIT
// ======================================================
const db = new sqlite3.Database("bot.sqlite");

db.run(`
  CREATE TABLE IF NOT EXISTS usersTokens (
    telegram_id INTEGER PRIMARY KEY,
    wallet TEXT,
    private_key TEXT,
    usdc_balance REAL DEFAULT 0,
    position_status TEXT DEFAULT 'NONE'
  )
`);

function encryptPrivateKey(privateKey, key) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return {
        iv: iv.toString('hex'),
        authTag,
        data: encrypted
    };
}
function decryptPrivateKey(encryptedObj, key) {
    const { iv, authTag, data } = encryptedObj;
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

// ======================================================
// HELPERS
// ======================================================
function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function runExec(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(true);
        });
    });
}

async function getFearGreed() {
    const res = await axios.get("https://api.alternative.me/fng/?limit=1");
    console.log(res.data.data[0].value)
    return parseInt(res.data.data[0].value);
}

// 🪙 Helper: get price & 24h change
async function getPrice(symbol) {
    try {
        console.log(`${API}/coins/`+ symbol)

        const res = await axios.get(`${API}/coins/`+ symbol, {

        });

        const data = res.data[symbol];

        console.log(res.data.market_data.current_price.usd)
        return {
            price: res.data.market_data.current_price.usd,

        };
    } catch (err) {
        console.error(err);

        return 0;
    }
}


// ======================================================
// BOT COMMANDS
// ======================================================

// START
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    if (msg.chat.type === "private") {
        await runExec(
            `INSERT OR IGNORE INTO usersTokens(telegram_id) VALUES(?)`,
            [chatId]
        );

        const mnemonic = process.env.MNEMONIC;
        // ALWAYS derive from the root. Never reuse the derived node.
        const derivationPath = "m/44'/60'/0'/0/";

        // Uses ethers.HDNodeWallet.fromMnemonic which handles both the mnemonic and the path
        const wallet = ethers.HDNodeWallet.fromMnemonic(
            ethers.Mnemonic.fromPhrase(mnemonic),
            derivationPath + chatId
        );
        await runExec(
            `UPDATE usersTokens SET wallet=?, private_key=? WHERE telegram_id=?`,
            [wallet.address, JSON.stringify(encryptPrivateKey(wallet.privateKey, KEY)), chatId]
        );
        bot.sendMessage(
            chatId, `🚀 Welcome to Simoshi!
            
The bot that buys btc when in extreme fear and sells it on extreme greed.
             
Your Deposit Address is: \`${wallet.address}\`
            
Deposit USDC through Base Blockchain in order to buy on extreme fear and sell on extreme greed. Deposit also at least 0.0001 ETH through Base Blockchain in order to pay for transactions fees.`, { parse_mode: "Markdown" });

        bot.sendMessage(
            chatId,
            `Commands:
- /status – Check portfolio
- /buyNow - Force Bot to buy BTC with USDC in walllet
- /closePosition – Close position by selling BTC for USDC
- /withdraw – Withdraw funds
- /check - Check current Fear/Greed Index
                `
        );


    }else{
        bot.sendMessage(
            chatId,
            `🚀 Welcome to Simoshi! You can now buy on extreme fear and sell on extreme greed!
Sent you a private message with your deposit address details!
`
        );

        await runExec(
            `INSERT OR IGNORE INTO usersTokens(telegram_id) VALUES(?)`,
            [msg.from.id]
        );

        const mnemonic = process.env.MNEMONIC;
        // ALWAYS derive from the root. Never reuse the derived node.
        const derivationPath = "m/44'/60'/0'/0/";

        // Uses ethers.HDNodeWallet.fromMnemonic which handles both the mnemonic and the path
        const wallet = ethers.HDNodeWallet.fromMnemonic(
            ethers.Mnemonic.fromPhrase(mnemonic),
            derivationPath + msg.from.id
        );
        await runExec(
            `UPDATE usersTokens SET wallet=?, private_key=? WHERE telegram_id=?`,
            [wallet.address, JSON.stringify(encryptPrivateKey(wallet.privateKey, KEY)), msg.from.id]
        );
        bot.sendMessage(
            msg.from.id, `🚀 Welcome to Simoshi!
            
The bot that buys btc when in extreme fear and sells it on extreme greed.
             
Your Deposit Address is: \`${wallet.address}\`
            
Deposit USDC through Base Blockchain in order to buy on extreme fear and sell on extreme greed. Deposit also at least 0.0001 ETH through Base Blockchain in order to pay for transactions fees.`, { parse_mode: "Markdown" });

        bot.sendMessage(
            msg.from.id,
            `Commands:
- /status – Check portfolio
- /buyNow - Force Bot to buy BTC with USDC in walllet
- /closePosition – Close position by selling BTC for USDC
- /withdraw – Withdraw funds
- /check - Check current Fear/Greed Index
                `
        );
    }


});

async function executeBuyTrade(id) {
    const user = await runQuery(
        `SELECT * FROM usersTokens WHERE telegram_id=?`,
        [id]
    );
    if (!user.length) return bot.sendMessage(id, "Not registered.");
    console.log(
        id, user[0]);

    if (user[0].wallet != null && user[0].wallet != null) {
        const balance = await baseProvider.getBalance(user[0].wallet);

        if(BigInt("10000000000000") <= BigInt(balance) ) {
            const userWallet = new ethers.Wallet(decryptPrivateKey(JSON.parse(user[0].private_key), KEY), baseProvider);

// --- Criar contrato ---
            const router = new ethers.Contract(SWAP_ROUTER, artifact2, userWallet);

// --- Definir quantidade ---
            const amountIn = 3000; // 0.01 WETH
            const amountOutMin = 0; // sem limite mínimo (ideal usar quoter)

// --- Aprovar o router ---
            const ERC20_ABI = [
                "function approve(address spender, uint256 amount) external returns (bool)"
            ];

            bot.sendMessage(id, "Buying BTC...");

            try{
                const wethContract2 = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, userWallet);
                const t = await wethContract2.approve(SWAP_ROUTER, amountIn);

                await t.wait();

// --- Criar os parâmetros do swap ---
                const params = {
                    tokenIn: USDC_ADDRESS,
                    tokenOut: CBBTC_ADDRESS,
                    fee: 500, // 0.05%
                    recipient: await userWallet.getAddress(),
                    deadline: Math.floor(Date.now() / 1000) + 60 * 5, // 5 minutos
                    amountIn,
                    amountOutMinimum: amountOutMin,
                    sqrtPriceLimitX96: 0
                };

// --- Executar swap ---
                const transactionStatus = await router.exactInputSingle(params, {
                    gasLimit: 300000
                });

                await transactionStatus.wait();

                bot.sendMessage(
                    id, "Successfully bought BTC!");
            }catch (e) {
                bot.sendMessage(
                    id, "Error buying BTC!");
            }

        }
    }
}

async function executeSellTrade(id) {
    const user = await runQuery(
        `SELECT * FROM usersTokens WHERE telegram_id=?`,
        [id]
    );
    if (!user.length) return bot.sendMessage(id, "Not registered.");
    console.log(
        id,user[0]);
    if(user[0].wallet != null && user[0].wallet != null) {
        const userWallet = new ethers.Wallet(decryptPrivateKey(JSON.parse(user[0].private_key), KEY), baseProvider);

// --- Criar contrato ---
        const router = new ethers.Contract(SWAP_ROUTER, artifact2 , userWallet);

        const factoryContract2 = new ethers.Contract(CBBTC_ADDRESS, artifact.abi, userWallet);
        // Check if pool already exists
        let cbbtcBalance = await factoryContract2.balanceOf(user[0].wallet);

// --- Definir quantidade ---
        const amountIn = cbbtcBalance; // 0.01 WETH
        const amountOutMin = 0; // sem limite mínimo (ideal usar quoter)

// --- Aprovar o router ---
        const ERC20_ABI = [
            "function approve(address spender, uint256 amount) external returns (bool)"
        ];
        const wethContract2 = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, userWallet);
        const t = await wethContract2.approve(SWAP_ROUTER, amountIn);

        await t.wait();

// --- Criar os parâmetros do swap ---
        const params = {
            tokenIn: CBBTC_ADDRESS,
            tokenOut: USDC_ADDRESS,
            fee: 500, // 0.05%
            recipient: await userWallet.getAddress(),
            deadline: Math.floor(Date.now() / 1000) + 60 * 5, // 5 minutos
            amountIn,
            amountOutMinimum: amountOutMin,
            sqrtPriceLimitX96: 0
        };

// --- Executar swap ---
        const transactionStatus = await router.exactInputSingle(params, {
            gasLimit: 300000
        });
        await transactionStatus.wait();

        bot.sendMessage(
            id,"Successfully sold BTC!");

    }
}

// REGISTER WALLET
bot.onText(/\/buyNow/, async (msg) => {

    const chatId = msg.chat.id;
    await executeBuyTrade(chatId);
});

// REGISTER WALLET
bot.onText(/\/closePosition/, async (msg) => {
    const chatId = msg.chat.id;
    await executeSellTrade(chatId);

});

// CHECK STATUS
bot.onText(/\/status/, async (msg) => {
    let chatId = msg.chat.id;

    if (msg.chat.type === "private") {
        const user = await runQuery(
            `SELECT * FROM usersTokens WHERE telegram_id=?`,
            [chatId]
        );
        if (!user.length) return bot.sendMessage(chatId, "Not registered.");
        console.log(
            chatId,user[0]);
        console.log(user);
        if(user[0].wallet != null && user[0].wallet != null){
            const userWallet = new ethers.Wallet(decryptPrivateKey(JSON.parse(user[0].private_key), KEY), baseProvider);

            const balance = await baseProvider.getBalance(user[0].wallet);

            const u = user[0];

            const factoryContract = new ethers.Contract(USDC_ADDRESS, artifact.abi, userWallet);
            // Check if pool already exists
            let usdcBalance = await factoryContract.balanceOf(user[0].wallet);

            const factoryContract2 = new ethers.Contract(CBBTC_ADDRESS, artifact.abi, userWallet);
            // Check if pool already exists
            let cbbtcBalance = await factoryContract2.balanceOf(user[0].wallet);
            let ethPrice, usdcPrice, btcPrice;
            try{
                ethPrice = await getPrice("ethereum");
                usdcPrice = await getPrice("usd-coin");
                btcPrice = await getPrice("bitcoin");
            }catch (e) {

            }

            let ethHoldings = Number(Number(ethers.formatEther(balance)) * Number(ethPrice.price)).toFixed(2);

            let usdcHoldings = Number(Number(ethers.formatUnits(usdcBalance, 6)) * Number(usdcPrice.price)).toFixed(2);

            let btcHoldings = Number(Number(ethers.formatEther(cbbtcBalance)) * Number(btcPrice.price)).toFixed(2);

            let totalHoldingas = Number(ethHoldings) + Number(usdcHoldings) + Number(btcHoldings);

            bot.sendMessage(
                chatId,
                `
📊 *Your Portfolio*
Wallet: \`${u.wallet || "Not set"}\`
ETH Balance: ${ethers.formatEther(balance)}  ($${ethHoldings})
USDC Balance: ${ethers.formatUnits(usdcBalance, 6)} ($${usdcHoldings})
BTC Balance: ${ethers.formatEther(cbbtcBalance)} ($${btcHoldings})
Total Portfolio Balance: $${totalHoldingas.toFixed(2)}
    `,
                { parse_mode: "Markdown" }
            );
        }
    }else{
        let userId = msg.from.id;
        const user = await runQuery(
            `SELECT * FROM usersTokens WHERE telegram_id=?`,
            [userId]
        );
        if (!user.length) return bot.sendMessage(chatId, "Not registered.");

        if(user[0].wallet != null && user[0].wallet != null){
            const userWallet = new ethers.Wallet(decryptPrivateKey(JSON.parse(user[0].private_key), KEY), baseProvider);

            const balance = await baseProvider.getBalance(user[0].wallet);

            const u = user[0];

            const factoryContract = new ethers.Contract(USDC_ADDRESS, artifact.abi, userWallet);
            // Check if pool already exists
            let usdcBalance = await factoryContract.balanceOf(user[0].wallet);

            const factoryContract2 = new ethers.Contract(CBBTC_ADDRESS, artifact.abi, userWallet);
            // Check if pool already exists
            let cbbtcBalance = await factoryContract2.balanceOf(user[0].wallet);
            let ethPrice, usdcPrice, btcPrice;
            try{
                ethPrice = await getPrice("ethereum");
                usdcPrice = {price:1}//await getPrice("usd-coin");
                btcPrice = await getPrice("bitcoin");
            }catch (e) {

            }

            let ethHoldings = Number(Number(ethers.formatEther(balance)) * Number(ethPrice.price)).toFixed(2);

            let usdcHoldings = Number(Number(ethers.formatUnits(usdcBalance, 6)) * Number(usdcPrice.price)).toFixed(2);

            let btcHoldings = Number(Number(ethers.formatEther(cbbtcBalance)) * Number(btcPrice.price)).toFixed(2);

            let totalHoldingas = Number(ethHoldings) + Number(usdcHoldings) + Number(btcHoldings);

            bot.sendMessage(
                chatId,
                `
📊 *Your Portfolio*
Wallet: \`${u.wallet || "Not set"}\`
ETH Balance: ${ethers.formatEther(balance)}  ($${ethHoldings})
USDC Balance: ${ethers.formatUnits(usdcBalance, 6)} ($${usdcHoldings})
BTC Balance: ${ethers.formatEther(cbbtcBalance)} ($${btcHoldings})
Total Portfolio Balance: $${totalHoldingas.toFixed(2)}
    `,
                { parse_mode: "Markdown" }
            );
        }
    }



});

bot.onText(/\/check/, async (msg) => {
    bot.sendMessage(msg.chat.id, `Current Fear/Greed Index: ${await getFearGreed()}`);
});

// WITHDRAW
bot.onText(/\/withdraw/, async (msg, match) => {
    console.log("match[1]");
    const chatId = msg.chat.id;

    console.log(match[1]);
    sessions[chatId] = { step: "ASK_ASSET" };

    const user = await runQuery(
        `SELECT * FROM usersTokens WHERE telegram_id=?`,
        [chatId]
    );
    if (!user.length) return bot.sendMessage(chatId, "Not registered. Call /start to create a wallet and deposit funds.");

    bot.sendMessage(chatId, `What asset do  do you want to withdraw? ETH, BTC or USDC? Input ALL to withdraw all.`);


});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    if (!sessions[chatId]) return; // User not in withdraw flow

    const state = sessions[chatId];

    // STEP 1 - Asset
    if (state.step === 'ASK_ASSET') {
        state.asset = text.toUpperCase();
        if(state.asset !== "ETH" && state.asset !== "BTC" && state.asset !== "USDC" && state.asset !== "ALL"){
            bot.sendMessage(chatId, "Invalid Asset. Valid assets are ETH, BTC and USDC.");
        }else if(state.asset === "ALL"){
            state.step = 'ASK_WALLET';
            bot.sendMessage(chatId, "Please enter the destination wallet address:");
        }else{
            state.step = 'ASK_AMOUNT';
            bot.sendMessage(chatId, "Please enter the amount you want to withdraw. Input ALL to withdraw all.");
        }
        return;
    }

    // STEP 2 - Amount
    if (state.step === 'ASK_AMOUNT') {

            bot.sendMessage(chatId, "Please enter the destination wallet address:");

        state.amount = text;
        state.step = 'ASK_WALLET';

        return;
    }

    let wall;
    // STEP 3 - Wallet
    if (state.step === 'ASK_WALLET') {
       // state.wallet = text;


        wall = text;


        function isValidEthereumAddress(address) {
            return ethers.isAddress(address);
        }
        if(isValidEthereumAddress(wall)){
            bot.sendMessage(
                chatId,
                `🧾 Confirm withdrawal:\n\n` +
                `Asset: ${state.asset}\n` +
                `Amount: ${state.amount}\n` +
                `Destination: ${wall.toString()}\n\n` +
                `Text OK to confirm transaction...`
            );

            // TODO: execute your blockchain transfer here

            // Example:
            // await withdrawFunds(state.asset, state.amount, state.wallet);

            state.step = 'ASK_CONFIRM';
        }else{
            bot.sendMessage(chatId, "Invalid destination wallet. Please enter a valid destination wallet address:");
        }



    }

    if (state.step === 'ASK_CONFIRM') {

        bot.sendMessage(chatId, "✅ Withdrawal submitted successfully!");

        delete sessions[chatId]; // Clear session
    }
});

// ======================================================
// AUTO TRADING LOOP
// ======================================================
async function runAutoTrading() {
    try {
        const fear = await getFearGreed();


        const users = await runQuery(`SELECT * FROM usersTokens`);

        for (const u of users) {
            if (!decryptPrivateKey(JSON.parse(u.private_key), KEY)) continue;
            const userWallet = new ethers.Wallet(decryptPrivateKey(JSON.parse(u.private_key), KEY), baseProvider);

            const balance = await baseProvider.getBalance(u.wallet);


                // BUY — Extreme Fear
                if (fear < 15) {
                    if(BigInt("100000000000000") <= BigInt(balance) ){
                    //  await executeBuyTrade(u.telegram_id);
                    bot.sendMessage(
                        u.telegram_id,
                        `😱 Extreme Fear (${fear}) → BUY executed!`
                    );
                    }else{
                        bot.sendMessage(
                            u.telegram_id,
                            `You don't have enough ether in your wallet to process transactions, please deposit at least 0.0001 ETH!`
                        );
                    }
                }

                // SELL — Extreme Greed
                if (fear > 85) {
                    // await executeSellTrade(u.telegram_id);
                    bot.sendMessage(
                        u.telegram_id,
                        `🤩 Extreme Greed (${fear}) → SELL executed!`
                    );
                }


        }
    } catch (e) {
        console.error(e);
    }
}

// Run every 10 minutes
setInterval(runAutoTrading, 120_000);

console.log("Telegram bot running...");