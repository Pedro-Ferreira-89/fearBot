require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const sqlite3 = require("sqlite3").verbose();
const axios = require("axios");
const Web3 = require("web3");
const ethers = require('ethers')
const {eth} = require("web3");
const artifact =require("./artifacts/token.js").artifact;
const artifact2 =require("./artifacts/router.js").artifact;

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
            [wallet.address, wallet.privateKey, chatId]
        );
        bot.sendMessage(
            chatId, `🚀 Welcome to Simoshi!
            
The bot that buys btc when in extreme fear and sells it on extreme greed.
             
Your Deposit Address is: ${wallet.address} 
            
Deposit at least 0.0001 ETH in order to pay for transactions fees. And deposit USDC through Base Blockchain in order to buy on extreme fear and sell on extreme greed.`);

        bot.sendMessage(
            chatId,
            ` Commands:
                - /status – Check portfolio
                - /buyNow - Force Bot to buy BTC with USDC in walllet
                - /closePosition – Close position by selling BTC for USDC
                - /withdraw – Withdraw funds
                `
        );


    }else{
        bot.sendMessage(
            chatId,
            `🚀 Welcome to Simoshi!
            To generate your deposit wallet call the /start command in the private messages of the bot!
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
        const userWallet = new ethers.Wallet(user[0].private_key, baseProvider);

// --- Criar contrato ---
        const router = new ethers.Contract(SWAP_ROUTER, artifact2, userWallet);

// --- Definir quantidade ---
        const amountIn = 3000; // 0.01 WETH
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
       const transactionStatus =  await router.exactInputSingle(params, {
            gasLimit: 300000
        });

       await transactionStatus.wait();

        bot.sendMessage(
            chatId,"Successfully bought BTC!");
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
        const userWallet = new ethers.Wallet(user[0].private_key, baseProvider);

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
            chatId,"Successfully sold BTC!");

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
    const chatId = msg.chat.id;

    const user = await runQuery(
        `SELECT * FROM usersTokens WHERE telegram_id=?`,
        [chatId]
    );
    if (!user.length) return bot.sendMessage(chatId, "Not registered.");
    console.log(
        chatId,user[0]);
    if(user[0].wallet != null && user[0].wallet != null){
        const userWallet = new ethers.Wallet(user[0].private_key, baseProvider);

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
ETH Balance: ${ethers.formatEther(balance)}  $${ethHoldings}
USDC Balance: ${ethers.formatUnits(usdcBalance, 6)} $${usdcHoldings}
BTC Balance: ${ethers.formatEther(cbbtcBalance)} $${btcHoldings}
Total Portfolio Balance: $${totalHoldingas.toFixed(2)}
    `,
            { parse_mode: "Markdown" }
        );
    }

});

// WITHDRAW
bot.onText(/\/withdraw (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const destinationWallet = match[1].trim();

    sessions[chatId] = { step: "awaitingAsset" };

    const user = await runQuery(
        `SELECT * FROM usersTokens WHERE telegram_id=?`,
        [chatId]
    );
    if (!user.length) return bot.sendMessage(chatId, "Not registered.");

    if(match[1].length < 5 ) return bot.sendMessage(chatId, "Not Address.");
    console.log(match[1]);
    if(user[0].wallet != null && user[0].private_key != null && match[1].length > 5 ) {
        try{
            const userWallet = new ethers.Wallet(user[0].private_key, baseProvider);

            const factoryContract = new ethers.Contract(USDC_ADDRESS, artifact.abi, userWallet);
            // Check if pool already exists
            let usdcBalance = await factoryContract.balanceOf(user[0].wallet);
            await factoryContract.transfer(destinationWallet, usdcBalance);
        }catch(e){
            bot.sendMessage(chatId, e.toString());
        }
        bot.sendMessage(chatId, `💸 Withdrawal sent to: ${destinationWallet}`);
    }else{
        bot.sendMessage(chatId, `💸 Failed sent to: ${destinationWallet}`);
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
            if (!u.private_key) continue;
            const userWallet = new ethers.Wallet(u.private_key, baseProvider);

            const balance = await baseProvider.getBalance(u.wallet);

            if(BigInt("100000000000000") <= BigInt(balance) ){
                // BUY — Extreme Fear
                if (fear < 25) {
                    //  await executeBuyTrade(u.telegram_id);
                    bot.sendMessage(
                        u.telegram_id,
                        `😱 Extreme Fear (${fear}) → BUY executed!`
                    );
                }

                // SELL — Extreme Greed
                if (fear > 75) {
                    // await executeSell(u.telegram_id);
                    bot.sendMessage(
                        u.telegram_id,
                        `🤩 Extreme Greed (${fear}) → SELL executed!`
                    );
                }
            }else{
                console.log("Not enough ether")
            }

        }
    } catch (e) {
        console.error(e);
    }
}

// Run every 10 minutes
setInterval(runAutoTrading, 600_000);

console.log("Telegram bot running...");