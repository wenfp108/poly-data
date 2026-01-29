const puppeteer = require('puppeteer');
const axios = require('axios');
// const http = require('http'); // 移除：GitHub Actions 不需要 HTTP 服务器

// ==========================================
// ✨ [保留] 0. 大师思维模型库 (Strategy Engine)
// ==========================================
const MASTERS = {
    // [塔勒布] 尾部风险
    TALEB: (m, prices) => {
        const isTail = prices.some(p => Number(p) < 0.05 || Number(p) > 0.95);
        return (isTail && Number(m.liquidity) > 5000) ? 'TAIL_RISK' : null;
    },
    // [索罗斯] 反身性
    SOROS: (m) => {
        const change = Math.abs(Number(m.oneDayPriceChange || 0));
        const vol24 = Number(m.volume24hr || 0);
        return (vol24 > 10000 && change > 0.05) ? 'REFLEXIVITY_TREND' : null;
    },
    // [芒格] 确定性
    MUNGER: (m) => {
        const spread = Number(m.spread || 1);
        const vol = Number(m.volume || 0);
        return (vol > 50000 && spread < 0.01) ? 'HIGH_CERTAINTY' : null;
    },
    // [纳瓦尔] 杠杆效应
    NAVAL: (m, category) => {
        const vol = Number(m.volume || 0);
        return (category === 'TECH' && vol > 20000) ? 'TECH_LEVERAGE' : null;
    }
};

// ==========================================
// 1. 智能目录分类器 (保留)
// ==========================================
function getCategory(title) {
    const t = title.toLowerCase();
    if (t.includes('fed') || t.includes('rate') || t.includes('cpi') || t.includes('inflation')) return 'ECONOMY';
    if (t.includes('gold') || t.includes('silver') || t.includes('s&p') || t.includes('market') || t.includes('stock')) return 'FINANCE';
    if (t.includes('bitcoin') || t.includes('eth') || t.includes('crypto') || t.includes('btc')) return 'CRYPTO';
    if (t.includes('election') || t.includes('president') || t.includes('senate') || t.includes('cabinet')) return 'POLITICS';
    if (t.includes('war') || t.includes('strike') || t.includes('border') || t.includes('conflict')) return 'GEOPOLITICS';
    if (t.includes('ai') || t.includes('gpt') || t.includes('nvidia') || t.includes('spacex')) return 'TECH';
    if (t.includes('disaster') || t.includes('climate') || t.includes('virus')) return 'SCIENCE';
    return 'WORLD'; 
}

// ==========================================
// 2. 远程领令逻辑 (保留)
// ==========================================
async function fetchQuestionsFromIssues() {
    const token = process.env.MY_PAT || process.env.GITHUB_TOKEN;
    const COMMAND_REPO = "wenfp108/Central-Bank"; 
    
    const issuesUrl = `https://api.github.com/repos/${COMMAND_REPO}/issues?state=open&per_page=100`;
    
    try {
        console.log("📡 Connecting to Central-Bank command center...");
        
        const resp = await axios.get(issuesUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github.v3+json'
            }
        });

        const questions = resp.data
            .filter(issue => issue.title.toLowerCase().includes('[poly]'))
            .map(issue => issue.title.replace(/\[poly\]/gi, '').trim());
            
        console.log(`✅ Tactical link active. ${questions.length} [poly] targets acquired.`);
        
        return questions;
    } catch (e) {
        console.error("❌ Link failed: Check MY_PAT permissions.");
        return [];
    }
}

// ==========================================
// 3. 智能问题生成器 (保留)
// ==========================================
async function generateQueries() {
    const rawTemplates = await fetchQuestionsFromIssues();
    
    if (rawTemplates.length === 0) {
        console.log("⚠️ No active [poly] commands found. Standing by.");
        return []; 
    }

    const now = new Date();
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const currMonth = months[now.getMonth()];
    const nextMonth = months[(now.getMonth() + 1) % 12];
    const currYear = String(now.getFullYear());
    const currDateStr = `${currMonth} ${now.getDate()}`;
    
    let finalQueries = [];
    rawTemplates.forEach(template => {
        let queriesToAdd = [];
        if (template.includes("{month}") || template.includes("{year}") || template.includes("{date}")) {
            let q1 = template.replace(/{month}/g, currMonth)
                             .replace(/{next_month}/g, nextMonth)
                             .replace(/{year}/g, currYear)
                             .replace(/{date}/g, currDateStr);
            queriesToAdd.push(q1);
            if (template.includes("{month}")) {
                let q2 = template.replace(/{month}/g, nextMonth)
                                 .replace(/{next_month}/g, months[(now.getMonth() + 2) % 12])
                                 .replace(/{year}/g, currYear)
                                 .replace(/{date}/g, currDateStr);
                queriesToAdd.push(q2);
            }
        } else {
            queriesToAdd.push(template);
        }
        
        queriesToAdd.forEach(q => {
            finalQueries.push({
                query: q,
                originalTitle: template 
            });
        });
    });
    return finalQueries;
}

// ==========================================
// 4. 模拟搜索 (保留)
// ==========================================
async function getSlugs() {
    const queryObjects = await generateQueries();
    if (queryObjects.length === 0) return [];

    const results = []; 
    
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        // GitHub Actions 环境会自动找到 Chrome，通常不需要指定路径，或者使用 'google-chrome-stable'
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined 
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    for (const obj of queryObjects) {
        try {
            console.log(`[SCOUTING] Searching target...`); 
            await page.goto(`https://polymarket.com/search?q=${encodeURIComponent(obj.query)}`, { waitUntil: 'networkidle2', timeout: 25000 });
            
            const slug = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a[href^="/event/"]'));
                for (const link of links) {
                    const href = link.getAttribute('href');
                    const parts = href.split('/');
                    const potentialSlug = parts.pop() || parts.pop();
                    if (potentialSlug !== 'live' && potentialSlug !== 'news' && potentialSlug !== 'activity') {
                        return potentialSlug;
                    }
                }
                return null;
            });
            
            if (slug) {
                results.push({ slug: slug, originalTitle: obj.originalTitle });
                console.log(`[MATCH] ✅ Target identified: ${slug}`);
            } else {
                console.log(`[FAIL] ❌ No intel found for this target.`);
            }
        } catch (e) { console.log(`[SKIP] Search timeout or error.`); }
    }
    await browser.close();
    
    const uniqueResults = [];
    const seenSlugs = new Set();
    for (const r of results) {
        if (!seenSlugs.has(r.slug)) {
            seenSlugs.add(r.slug);
            uniqueResults.push(r);
        }
    }
    return uniqueResults;
}

// ==========================================
// 5. 数据同步 (保留逻辑，移除 Server)
// ==========================================
async function syncData() {
    // 自动获取 owner 和 repo 名称 (GitHub Actions 注入的环境变量)
    const REPO_OWNER = process.env.REPO_OWNER || process.env.GITHUB_REPOSITORY_OWNER;
    // 如果 Actions 环境下 GITHUB_REPOSITORY 是 "owner/repo"，我们需要拆分
    let REPO_NAME = process.env.REPO_NAME;
    if (!REPO_NAME && process.env.GITHUB_REPOSITORY) {
         REPO_NAME = process.env.GITHUB_REPOSITORY.split('/')[1];
    }
    
    const TOKEN = process.env.MY_PAT || process.env.GITHUB_TOKEN;

    if (!TOKEN) return console.log("❌ Missing Secrets! (MY_PAT required)");
    
    const taskResults = await getSlugs();
    if (taskResults.length === 0) return console.log("No data to sync.");

    let processedData = [];
    
    for (const task of taskResults) {
        try {
            const resp = await axios.get(`https://gamma-api.polymarket.com/events?slug=${task.slug}`);
            const event = resp.data[0];
            if (!event || !event.markets) continue;
            
            event.markets.forEach(m => {
                if (!m.active || m.closed || m.archived) return;
                
                const totalVol = Number(m.volume || 0);
                const liq = Number(m.liquidity || 0);
                if (totalVol < 10 && liq < 10) return; 
                
                let prices = [], outcomes = [];
                try {
                    prices = JSON.parse(m.outcomePrices);
                    outcomes = JSON.parse(m.outcomes);
                } catch (e) { return; }
                
                let priceStr = outcomes.map((o, i) => `${o}: ${(Number(prices[i]) * 100).toFixed(1)}%`).join(" | ");
                
                // --- ✨ 大师策略打标 (保留) ---
                const category = getCategory(task.originalTitle);
                const masterTags = [];
                
                for (const [name, logic] of Object.entries(MASTERS)) {
                    const tag = logic(m, prices, category);
                    if (tag) masterTags.push(tag);
                }
                if (masterTags.length === 0) masterTags.push("RAW_MARKET");
                // ---------------------

                processedData.push({
                    slug: task.slug,
                    ticker: m.slug,
                    question: m.groupItemTitle || m.question,
                    eventTitle: event.title,
                    prices: priceStr,
                    volume: Math.round(totalVol),
                    liquidity: Math.round(liq),
                    endDate: m.endDate ? m.endDate.split("T")[0] : "N/A",
                    dayChange: m.oneDayPriceChange ? (Number(m.oneDayPriceChange) * 100).toFixed(2) + "%" : "0.00%",
                    vol24h: Math.round(Number(m.volume24hr || 0)),
                    spread: m.spread ? (Number(m.spread) * 100).toFixed(2) + "%" : "N/A",
                    sortOrder: Number(m.groupItemThreshold || 0),
                    updatedAt: m.updatedAt,
                    engine: "sniper",
                    core_topic: task.originalTitle,
                    category: category, 
                    url: `https://polymarket.com/event/${task.slug}`,
                    strategy_tags: masterTags 
                });
            });
        } catch (e) { console.error(`Fetch Err: ${task.slug}`); }
    }
    
    if (processedData.length === 0) return console.log("No valid data extracted.");
    
    processedData.sort((a, b) => b.volume - a.volume);
    
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const timePart = `${now.getHours().toString().padStart(2, '0')}_${now.getMinutes().toString().padStart(2, '0')}`;
    const fileName = `sniper-${year}-${month}-${day}-${timePart}.json`;
    const datePart = now.toISOString().split('T')[0];
    const path = `data/strategy/${datePart}/${fileName}`;
    
    // 写入 Github
    await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
        message: `Structured Sync: ${fileName}`,
        content: Buffer.from(JSON.stringify(processedData, null, 2)).toString('base64')
    }, { headers: { Authorization: `Bearer ${TOKEN}` } });
    
    console.log(`✅ Success: Archived ${processedData.length} structured items to ${path}`);
}

// ==========================================
// 6. [修改] 执行入口
// ==========================================
// 立即执行并退出，适配 GitHub Actions 的短暂运行特性
(async () => {
    console.log("🚀 Sniper Agent Initializing...");
    try {
        await syncData();
        console.log("🏁 Mission Complete. Exiting.");
        process.exit(0);
    } catch (error) {
        console.error("❌ Fatal Error during execution:", error);
        process.exit(1);
    }
})();
