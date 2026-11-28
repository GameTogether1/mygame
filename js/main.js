/**
 * 主业务模块（纯静态 JS 版本）
 * 架构：首页精选（本周更新新游 + 模拟器专区）+ 按需展开视图（点击 A-Z 字母索引或类别索引才铺出对应游戏）
 */

const LETTERS = 'ABCDEFGHJKLMNOPQRSTWXYZ'.split('');
const GAME_CATEGORIES = [
    '动作', '冒险', '角色扮演', '射击', '策略', '体育',
    '竞速', '模拟', '解谜', '恐怖', '格斗', '生存', '工具'
];
const BROWSE_PAGE_SIZE = 24;

let gameData = null;
let allGames = [];
let gameById = new Map();
let gameLetterMap = new Map(); // gameId -> letter (or 'EMULATOR')
let categoryCounts = {};

// 当前视图状态：{ mode: 'home' } | { mode: 'letter', value: 'A' } | { mode: 'category', value: '角色扮演' }
let currentView = { mode: 'home', value: null };
let browseRawGames = [];
let browseGamesList = [];
let browseLoadedCount = 0;
let browseSortByRating = false;
const FALLBACK_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='225'%3E%3Crect fill='%23151c2e' width='400' height='225'/%3E%3Ctext fill='%2364748b' font-family='sans-serif' font-size='15' x='50%25' y='50%25' text-anchor='middle' dominant-baseline='middle'%3E暂无封面%3C/text%3E%3C/svg%3E";

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[m]));
}

// ========== 夸克二维码弹窗 ==========
function openQuarkQrModal(link) {
    const canvas = document.getElementById('quark-qrcode-canvas');
    if (!canvas) return;
    window.openModalById('quark-qrcode-modal');
    if (window.QRCode) {
        window.QRCode.toCanvas(canvas, link, { width: 220 }, (err) => {
            if (err) console.error('二维码生成失败:', err);
        });
    }
}

// ========== 统一下载与限额校验（迅雷复制 / 夸克弹窗） ==========
async function deliverLink(cleanLink, type, btnEl) {
    if (type === 'thunder') {
        try {
            await navigator.clipboard.writeText(cleanLink);
            window.showToast('复制链接成功，保存到网盘', 'success');
            if (btnEl) {
                const origHtml = btnEl.innerHTML;
                btnEl.innerHTML = '<i class="fa fa-check"></i><span>已复制</span>';
                btnEl.classList.add('ring-2', 'ring-green-400');
                setTimeout(() => {
                    btnEl.innerHTML = origHtml;
                    btnEl.classList.remove('ring-2', 'ring-green-400');
                }, 1500);
            }
        } catch {
            window.showToast('复制失败，请检查浏览器剪贴板权限', 'error');
        }
    } else {
        openQuarkQrModal(cleanLink);
    }
}

async function handleDownload(gameId, link, type, btnEl) {
    if (!link) return;

    const user = window.AuthState.getUser();
    const profile = window.AuthState.getProfile();
    const supabase = window.AuthState.supabase;

    // 1. 未登录 -> 弹出登录框
    if (!user || !profile) {
        window.AuthState.openAuthModal();
        return;
    }

    const cleanLink = link.replace(/\\n/g, '').trim();

    // 2. 会员无限制
    if (profile.is_member === true) {
        await deliverLink(cleanLink, type, btnEl);
        return;
    }

    // 3. 非会员每日限额检查（单日 1 款游戏，当日已获取的游戏可重复获取）
    if (!supabase) return;
    const today = new Date().toISOString().slice(0, 10);

    try {
        const { data, error } = await supabase
            .from('GameTogether')
            .select('daily_download_count, daily_download_date, daily_download_game_id')
            .eq('id', profile.id)
            .single();

        if (error || !data) {
            window.showToast('查询下载额度失败，请稍后重试', 'error');
            return;
        }

        let count = data.daily_download_count || 0;
        const date = data.daily_download_date;
        let allowedGameId = data.daily_download_game_id;

        if (date !== today) {
            count = 0;
            allowedGameId = null;
            await supabase
                .from('GameTogether')
                .update({
                    daily_download_count: 0,
                    daily_download_date: today,
                    daily_download_game_id: null
                })
                .eq('id', profile.id);
        }

        if (allowedGameId && allowedGameId === gameId) {
            await deliverLink(cleanLink, type, btnEl);
            return;
        }

        if (count >= 1) {
            window.AuthState.openLimitModal();
            return;
        }

        await supabase
            .from('GameTogether')
            .update({
                daily_download_count: count + 1,
                daily_download_date: today,
                daily_download_game_id: gameId
            })
            .eq('id', profile.id);

        await deliverLink(cleanLink, type, btnEl);
    } catch (err) {
        console.error('下载校验失败:', err);
        window.showToast('网络异常，请稍后重试', 'error');
    }
}

// ========== 创建单张游戏卡片 ==========
function createCardElement(game, options = {}) {
    const { isEmulator = false, isNew = false, domIdPrefix = '' } = options;
    const card = document.createElement('div');
    card.id = domIdPrefix ? `${domIdPrefix}${game.id}` : game.id;
    card.className = 'game-card';

    const newBadge = isNew
        ? `<div class="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full bg-gradient-to-r from-rose-500 to-orange-500 text-[11px] font-bold text-white shadow-md flex items-center gap-1">
               <i class="fa fa-fire"></i><span>NEW</span>
           </div>`
        : '';

    const ratingBadge = (!isEmulator && game.rating)
        ? `<div class="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-sm text-xs font-semibold text-yellow-400 flex items-center gap-1 border border-white/10">
               <i class="fa fa-star"></i><span>${escapeHtml(game.rating)}</span>
           </div>`
        : '';

    const sizeBadge = (!isEmulator && game.size)
        ? `<span class="px-2 py-0.5 rounded-md bg-white/5 text-gray-300 text-xs flex items-center gap-1 border border-white/10">
               <i class="fa fa-hdd-o text-gray-400"></i>${escapeHtml(game.size)}
           </span>`
        : '';

    card.innerHTML = `
        <div class="game-card-img-wrap">
            <img src="${escapeHtml(game.image)}" alt="${escapeHtml(game.name)}" class="game-card-img" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'">
            ${newBadge}
            ${ratingBadge}
        </div>
        <div class="p-4 flex-1 flex flex-col">
            <h3 class="text-base font-bold text-white mb-1.5 line-clamp-1" title="${escapeHtml(game.name)}">${escapeHtml(game.name)}</h3>
            <p class="text-xs text-gray-400 mb-3 line-clamp-2 flex-1">${escapeHtml(game.description || '')}</p>
            <div class="flex flex-wrap items-center gap-1.5 mb-3">
                <span class="px-2 py-0.5 rounded-md bg-primary/20 text-indigo-300 text-xs font-medium border border-primary/30">${escapeHtml(game.category)}</span>
                ${sizeBadge}
            </div>
            <div class="flex gap-2 mt-auto">
                ${game.thunderLink ? `
                    <button type="button" data-action="download" data-type="thunder" class="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition">
                        <i class="fa fa-bolt"></i><span>迅雷网盘</span>
                    </button>` : ''}
                ${game.quarkLink ? `
                    <button type="button" data-action="download" data-type="quark" class="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition">
                        <i class="fa fa-cloud-download"></i><span>夸克网盘</span>
                    </button>` : ''}
            </div>
        </div>
    `;

    card.querySelectorAll('[data-action="download"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            const link = type === 'thunder' ? game.thunderLink : game.quarkLink;
            handleDownload(game.id, link, type, btn);
        });
    });

    return card;
}

// ========== 视图切换核心（首页 / 字母索引 / 类别索引） ==========
function renderCategoryFilters() {
    const container = document.getElementById('category-filter-tags');
    const clearBtn = document.getElementById('category-clear-btn');
    if (!container) return;

    container.innerHTML = '';
    GAME_CATEGORIES.forEach((cat) => {
        const count = categoryCounts[cat] || 0;
        const active = currentView.mode === 'category' && currentView.value === cat;
        const btn = document.createElement('button');
        btn.className = active
            ? 'px-3.5 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-primary to-secondary text-white shadow-md shadow-primary/30 transition'
            : 'px-3.5 py-1.5 rounded-full text-xs font-medium bg-dark-lighter/70 hover:bg-primary/25 text-gray-300 hover:text-white border border-white/10 transition';
        btn.innerHTML = `${escapeHtml(cat)} <span class="opacity-65 ml-0.5">(${count})</span>`;
        btn.addEventListener('click', () => {
            if (active) showHomeView();
            else showCategoryView(cat);
        });
        container.appendChild(btn);
    });

    if (clearBtn) {
        const isNotHome = currentView.mode !== 'home';
        clearBtn.classList.toggle('hidden', !isNotHome);
        clearBtn.classList.toggle('inline-flex', isNotHome);
    }
}

function renderLetterNav() {
    const nav = document.getElementById('letter-nav-scroll');
    if (!nav || !gameData) return;

    nav.innerHTML = '';

    // 首页按钮
    const homeBtn = document.createElement('button');
    const isHome = currentView.mode === 'home';
    homeBtn.className = isHome
        ? 'shrink-0 px-3 h-8 rounded-lg text-xs font-bold bg-gradient-to-r from-primary to-secondary text-white shadow-md shadow-primary/30 transition flex items-center gap-1'
        : 'shrink-0 px-3 h-8 rounded-lg text-xs font-bold bg-dark-lighter/80 hover:bg-primary/30 text-gray-200 transition flex items-center gap-1';
    homeBtn.innerHTML = '<i class="fa fa-home"></i><span>首页</span>';
    homeBtn.addEventListener('click', showHomeView);
    nav.appendChild(homeBtn);

    // 分隔线
    const divider = document.createElement('div');
    divider.className = 'shrink-0 w-px h-5 bg-white/10 mx-1';
    nav.appendChild(divider);

    // A-Z 字母按钮
    LETTERS.forEach((letter) => {
        const count = (gameData.gamesByLetter?.[letter] || []).length;
        const hasGames = count > 0;
        const isActive = currentView.mode === 'letter' && currentView.value === letter;

        const btn = document.createElement('button');
        btn.textContent = letter;
        btn.disabled = !hasGames;
        btn.title = hasGames ? `${letter} 开头游戏 (${count} 款)` : '暂无游戏';
        if (isActive) {
            btn.className = 'shrink-0 w-8 h-8 rounded-lg text-xs font-bold bg-gradient-to-r from-primary to-secondary text-white shadow-md shadow-primary/30 transition';
        } else if (hasGames) {
            btn.className = 'shrink-0 w-8 h-8 rounded-lg text-xs font-bold bg-dark-lighter/80 hover:bg-primary text-gray-200 hover:text-white transition';
        } else {
            btn.className = 'shrink-0 w-8 h-8 rounded-lg text-xs font-bold bg-white/5 text-gray-600 cursor-not-allowed';
        }

        if (hasGames) {
            btn.addEventListener('click', () => showLetterView(letter));
        }
        nav.appendChild(btn);
    });
}

function showHomeView(scrollToTop = true) {
    currentView = { mode: 'home', value: null };
    document.getElementById('hero-section')?.classList.remove('hidden');
    document.getElementById('home-view')?.classList.remove('hidden');
    document.getElementById('browse-view')?.classList.add('hidden');
    renderCategoryFilters();
    renderLetterNav();
    if (scrollToTop) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderBrowseBatch() {
    const grid = document.getElementById('browse-grid');
    const loadMoreWrap = document.getElementById('browse-load-more-wrap');
    const loadMoreText = document.getElementById('browse-load-more-text');
    if (!grid) return;

    const nextSlice = browseGamesList.slice(browseLoadedCount, browseLoadedCount + BROWSE_PAGE_SIZE);
    const fragment = document.createDocumentFragment();
    nextSlice.forEach((game) => {
        const isEmu = gameLetterMap.get(game.id) === 'EMULATOR';
        fragment.appendChild(createCardElement(game, { isEmulator: isEmu }));
    });
    grid.appendChild(fragment);
    browseLoadedCount += nextSlice.length;

    const remaining = browseGamesList.length - browseLoadedCount;
    if (loadMoreWrap) {
        if (remaining > 0) {
            loadMoreWrap.classList.remove('hidden');
            loadMoreWrap.classList.add('flex');
            if (loadMoreText) loadMoreText.textContent = `加载更多游戏（剩余 ${remaining} 款）`;
        } else {
            loadMoreWrap.classList.add('hidden');
            loadMoreWrap.classList.remove('flex');
        }
    }
}

function syncSortButtonUI() {
    const btn = document.getElementById('browse-sort-btn');
    const label = document.getElementById('browse-sort-label');
    if (label) label.textContent = browseSortByRating ? '高分优先 ✓' : '按评分排序';
    if (btn) {
        btn.classList.toggle('border-amber-400/60', browseSortByRating);
        btn.classList.toggle('bg-amber-500/20', browseSortByRating);
    }
}

function openBrowseView({ mode, value, badgeHtml, title, games, loadAll = false }) {
    currentView = { mode, value };
    browseRawGames = [...games];
    browseGamesList = browseSortByRating
        ? [...games].sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0))
        : [...games];
    browseLoadedCount = 0;
    syncSortButtonUI();

    document.getElementById('hero-section')?.classList.add('hidden');
    document.getElementById('home-view')?.classList.add('hidden');
    const browseView = document.getElementById('browse-view');
    browseView?.classList.remove('hidden');

    document.getElementById('browse-badge').innerHTML = badgeHtml;
    document.getElementById('browse-title').textContent = title;
    document.getElementById('browse-count').textContent = `共 ${games.length} 款游戏`;

    const grid = document.getElementById('browse-grid');
    grid.innerHTML = '';

    if (!games.length) {
        grid.innerHTML = '<div class="col-span-full text-center py-16 text-gray-400">该索引下暂无游戏</div>';
        document.getElementById('browse-load-more-wrap')?.classList.add('hidden');
    } else if (loadAll) {
        const fragment = document.createDocumentFragment();
        games.forEach((game) => {
            const isEmu = gameLetterMap.get(game.id) === 'EMULATOR';
            fragment.appendChild(createCardElement(game, { isEmulator: isEmu }));
        });
        grid.appendChild(fragment);
        browseLoadedCount = games.length;
        document.getElementById('browse-load-more-wrap')?.classList.add('hidden');
    } else {
        renderBrowseBatch();
    }

    renderCategoryFilters();
    renderLetterNav();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showLetterView(letter, loadAll = false) {
    const list = gameData?.gamesByLetter?.[letter] || [];
    openBrowseView({
        mode: 'letter',
        value: letter,
        badgeHtml: escapeHtml(letter),
        title: `${letter} 字母开头游戏`,
        games: list,
        loadAll
    });
}

function showCategoryView(category, loadAll = false) {
    const list = allGames.filter((g) => g.category === category);
    openBrowseView({
        mode: 'category',
        value: category,
        badgeHtml: '<i class="fa fa-tag text-lg"></i>',
        title: `${category} 类游戏`,
        games: list,
        loadAll
    });
}

// ========== 渲染首页模块：本周更新新游 ==========
function resolveWeeklyGames() {
    const weeklyCfg = gameData?.weeklyUpdates || [];
    const resolved = [];

    weeklyCfg.forEach((item) => {
        if (typeof item === 'string') {
            const found = gameById.get(item);
            if (found) resolved.push(found);
        } else if (item && typeof item === 'object' && item.id) {
            resolved.push(item);
        }
    });

    // 若未配置 weeklyUpdates，自动兜底取前 8 个字母末尾的最新入库游戏
    if (!resolved.length && gameData?.gamesByLetter) {
        for (const letter of LETTERS) {
            const arr = gameData.gamesByLetter[letter] || [];
            if (arr.length) resolved.push(arr[arr.length - 1]);
            if (resolved.length >= 8) break;
        }
    }
    return resolved;
}

function renderWeeklyUpdates() {
    const grid = document.getElementById('weekly-grid');
    const countEl = document.getElementById('weekly-count');
    const dateBadge = document.getElementById('weekly-date-badge');
    if (!grid) return;

    const weeklyGames = resolveWeeklyGames();
    grid.innerHTML = '';

    const fragment = document.createDocumentFragment();
    weeklyGames.forEach((game) => {
        fragment.appendChild(createCardElement(game, { isNew: true, domIdPrefix: 'weekly-' }));
    });
    grid.appendChild(fragment);

    if (countEl) countEl.textContent = `本期精选 ${weeklyGames.length} 款新游`;
    if (dateBadge && gameData?.weeklyUpdateDate) {
        dateBadge.textContent = `更新于 ${gameData.weeklyUpdateDate}`;
        dateBadge.classList.remove('hidden');
    }
}

// ========== 全站搜索与精准定位 ==========
function jumpToGameCard(game) {
    window.closeModalById('search-modal');

    const letter = gameLetterMap.get(game.id);
    if (letter === 'EMULATOR') {
        showCategoryView(game.category || '工具', true);
    } else if (letter) {
        // 切到该游戏所在字母并确保全部渲染，避免目标在“加载更多”之后找不到
        showLetterView(letter, true);
    }

    setTimeout(() => {
        const el = document.getElementById(game.id);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.remove('search-highlight');
        void el.offsetWidth;
        el.classList.add('search-highlight');
        setTimeout(() => el.classList.remove('search-highlight'), 1600);
    }, 100);
}

function renderSearchResults(keyword) {
    const body = document.getElementById('search-results-body');
    if (!body) return;

    const q = keyword.trim().toLowerCase();
    if (!q) {
        body.innerHTML = '<p class="text-center text-sm text-gray-500 py-8">输入关键词开始搜索...</p>';
        return;
    }

    const matches = allGames.filter((g) =>
        (g.name && g.name.toLowerCase().includes(q)) ||
        (g.category && g.category.toLowerCase().includes(q))
    ).slice(0, 20);

    if (!matches.length) {
        body.innerHTML = '<p class="text-center text-sm text-gray-400 py-8">未找到相关游戏</p>';
        return;
    }

    body.innerHTML = `<div class="text-xs text-gray-400 px-2 pb-2">找到 ${matches.length} 款结果</div>`;
    const list = document.createElement('div');
    list.className = 'space-y-1.5';

    matches.forEach((game) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/10 text-left transition';
        item.innerHTML = `
            <img src="${escapeHtml(game.image)}" alt="${escapeHtml(game.name)}" class="w-16 h-10 rounded-lg object-cover bg-dark shrink-0" loading="lazy">
            <div class="min-w-0 flex-1">
                <div class="text-sm font-semibold text-white truncate">${escapeHtml(game.name)}</div>
                <div class="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                    <span class="text-indigo-300">${escapeHtml(game.category)}</span>
                    ${game.size ? `<span>· ${escapeHtml(game.size)}</span>` : ''}
                </div>
            </div>
            <i class="fa fa-angle-right text-gray-500"></i>
        `;
        item.addEventListener('click', () => jumpToGameCard(game));
        list.appendChild(item);
    });

    body.appendChild(list);
}

// ========== 数据加载与初始化 ==========
async function loadGames() {
    const loadingEl = document.getElementById('loading-state');
    const errorEl = document.getElementById('error-state');
    const errorMsg = document.getElementById('error-message');

    try {
        const res = await fetch('data/games.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        gameData = await res.json();

        allGames = [];
        gameById.clear();
        gameLetterMap.clear();
        categoryCounts = {};

        (gameData.emulators || []).forEach((emu) => {
            allGames.push(emu);
            gameById.set(emu.id, emu);
            gameLetterMap.set(emu.id, 'EMULATOR');
            if (emu.category) categoryCounts[emu.category] = (categoryCounts[emu.category] || 0) + 1;
        });

        LETTERS.forEach((letter) => {
            (gameData.gamesByLetter?.[letter] || []).forEach((g) => {
                allGames.push(g);
                gameById.set(g.id, g);
                gameLetterMap.set(g.id, letter);
                if (g.category) categoryCounts[g.category] = (categoryCounts[g.category] || 0) + 1;
            });
        });

        const totalBadge = document.getElementById('total-games-badge');
        if (totalBadge) totalBadge.textContent = `全站共收录 ${allGames.length} 款资源`;

        loadingEl?.classList.add('hidden');
        renderWeeklyUpdates();
        showHomeView(false);
    } catch (err) {
        console.error('加载 games.json 失败:', err);
        loadingEl?.classList.add('hidden');
        if (errorMsg) errorMsg.textContent = '加载游戏数据失败，请使用本地服务器或部署环境打开页面';
        errorEl?.classList.remove('hidden');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // 统一关闭弹窗
    document.querySelectorAll('[data-close-modal]').forEach((el) => {
        el.addEventListener('click', () => window.closeModalById(el.dataset.closeModal));
    });

    // Esc 键关闭最上层弹窗
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const modalOrder = [
            'quark-qrcode-modal', 'limit-modal', 'payment-modal',
            'password-modal', 'forgot-modal', 'account-modal',
            'auth-modal', 'search-modal'
        ];
        for (const id of modalOrder) {
            const el = document.getElementById(id);
            if (el && !el.classList.contains('hidden')) {
                window.closeModalById(id);
                break;
            }
        }
    });

    // 返回首页按钮（Logo、分类栏返回、索引页返回）
    document.getElementById('brand-home-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        showHomeView(true);
    });
    document.getElementById('category-clear-btn')?.addEventListener('click', () => showHomeView(true));
    document.getElementById('browse-back-home-btn')?.addEventListener('click', () => showHomeView(true));

    // 加载更多按钮与评分排序切换
    document.getElementById('browse-load-more-btn')?.addEventListener('click', renderBrowseBatch);
    document.getElementById('browse-sort-btn')?.addEventListener('click', () => {
        browseSortByRating = !browseSortByRating;
        syncSortButtonUI();
        browseGamesList = browseSortByRating
            ? [...browseRawGames].sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0))
            : [...browseRawGames];
        browseLoadedCount = 0;
        const grid = document.getElementById('browse-grid');
        if (grid) grid.innerHTML = '';
        renderBrowseBatch();
    });

    // 搜索弹窗事件
    const searchInput = document.getElementById('search-input');
    document.getElementById('open-search-btn')?.addEventListener('click', () => {
        window.openModalById('search-modal');
        if (searchInput) {
            searchInput.value = '';
            renderSearchResults('');
            setTimeout(() => searchInput.focus(), 50);
        }
    });
    searchInput?.addEventListener('input', (e) => renderSearchResults(e.target.value));

    // 返回顶部按钮
    const backToTopBtn = document.getElementById('back-to-top-btn');
    window.addEventListener('scroll', () => {
        if (!backToTopBtn) return;
        const show = window.scrollY > 500;
        backToTopBtn.classList.toggle('hidden', !show);
        backToTopBtn.classList.toggle('flex', show);
    }, { passive: true });
    backToTopBtn?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

    loadGames();
});
