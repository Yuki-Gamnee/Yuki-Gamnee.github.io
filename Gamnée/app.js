// --- 配置与数据库 ---
const DB_NAME = 'GamnéeDB_v7'; 
const DB_VERSION = 1;

const db = {
    instance: null,
    init: function() {
        return new Promise((resolve) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const d = e.target.result;
                if (!d.objectStoreNames.contains('games')) d.createObjectStore('games', { keyPath: 'id' });
                if (!d.objectStoreNames.contains('oshi')) d.createObjectStore('oshi', { keyPath: 'id' });
            };
            req.onsuccess = (e) => {
                this.instance = e.target.result;
                resolve();
            };
        });
    },
    put: function(store, data) {
        return new Promise((resolve) => {
            const tx = this.instance.transaction(store, 'readwrite');
            tx.objectStore(store).put(data).onsuccess = () => resolve();
        });
    },
    getAll: function(store) {
        return new Promise((resolve) => {
            const tx = this.instance.transaction(store, 'readonly');
            tx.objectStore(store).getAll().onsuccess = (e) => resolve(e.target.result);
        });
    },
    delete: function(store, id) {
        return new Promise(resolve => {
            const tx = this.instance.transaction(store, 'readwrite');
            tx.objectStore(store).delete(id).onsuccess = () => resolve();
        });
    },
    clear: function(store) {
        return new Promise(resolve => {
            const tx = this.instance.transaction(store, 'readwrite');
            tx.objectStore(store).clear().onsuccess = () => resolve();
        });
    }
};

const app = {
    data: { games: [], oshi: [] },
    currentTab: 'wishlist',
    cropper: null,
    activeCropTarget: null,
    tempTags: [],

    init: async function() {
        await db.init();
        await this.loadData();
        this.loadUserSettings();
        this.bindEvents();
        this.render();
    },

    loadUserSettings: function() {
        const name = localStorage.getItem('gamnee_username');
        const bio = localStorage.getItem('gamnee_bio');
        const avatar = localStorage.getItem('gamnee_avatar');
        if(name) document.getElementById('user-name-input').value = name;
        if(bio) document.getElementById('user-bio-input').value = bio;
        if(avatar) document.getElementById('preview-user-avatar').src = avatar;
    },

    loadData: async function() {
        this.data.games = (await db.getAll('games')).sort((a,b) => b.createdAt - a.createdAt);
        this.data.oshi = await db.getAll('oshi');
    },

    bindEvents: function() {
        // Tab切换
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                target.classList.add('active');
                this.currentTab = target.dataset.tab;
                
                const toolbar = document.getElementById('library-toolbar');
                toolbar.style.display = this.currentTab === 'library' ? 'flex' : 'none';
                
                this.render();
            });
        });

        // 库搜索与排序
        document.getElementById('lib-search').addEventListener('input', () => this.render());
        let sortOrder = 'date'; 
        document.getElementById('btn-sort').addEventListener('click', () => {
            if(sortOrder === 'date') sortOrder = 'name';
            else if(sortOrder === 'name') sortOrder = 'status';
            else sortOrder = 'date';
            this.render(sortOrder);
        });

        // Sheet关闭
        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById(btn.dataset.close).classList.remove('active');
            });
        });

        // FAB 添加
        document.getElementById('fab-add').addEventListener('click', () => {
            this.currentTab === 'oshi' ? this.openOshiForm() : this.openGameForm();
        });

        // 设置与备份
        document.getElementById('btn-settings').addEventListener('click', () => {
            document.getElementById('sheet-settings').classList.add('active');
        });
        document.getElementById('btn-save-settings').addEventListener('click', () => {
            localStorage.setItem('gamnee_username', document.getElementById('user-name-input').value);
            localStorage.setItem('gamnee_bio', document.getElementById('user-bio-input').value);
            localStorage.setItem('gamnee_avatar', document.getElementById('preview-user-avatar').src);
            alert('设置已保存');
            document.getElementById('sheet-settings').classList.remove('active');
        });
        document.getElementById('btn-backup-export').addEventListener('click', () => this.exportBackup());
        document.getElementById('btn-backup-import-trigger').addEventListener('click', () => {
            if(confirm('恢复数据将覆盖当前所有数据，确定吗？')) {
                document.getElementById('backup-file-input').click();
            }
        });
        document.getElementById('backup-file-input').addEventListener('change', (e) => this.importBackup(e));

        // 状态选择
        document.querySelectorAll('.status-option').forEach(opt => {
            opt.addEventListener('click', () => {
                document.querySelectorAll('.status-option').forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                document.getElementById('game-status').value = opt.dataset.val;
            });
        });

        // Tag 输入
        const tagInput = document.getElementById('oshi-tag-input');
        tagInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const val = tagInput.value.trim().replace(/^#/, '');
                if (val && !this.tempTags.includes(val)) {
                    this.tempTags.push(val);
                    this.renderTagsInForm();
                    tagInput.value = '';
                }
            }
        });

        // --- 图片裁剪核心 ---
        const globalInput = document.getElementById('global-file-input');
        const setupCrop = (triggerId, imgId) => {
            const el = document.getElementById(triggerId);
            if(el) {
                el.addEventListener('click', () => {
                    this.activeCropTarget = imgId;
                    globalInput.value = ''; 
                    globalInput.click();
                });
            }
        };
        setupCrop('trigger-game-cover', 'preview-game-cover');
        setupCrop('trigger-oshi-avatar', 'preview-oshi-avatar');
        setupCrop('trigger-user-avatar', 'preview-user-avatar');
        setupCrop('trigger-quick-oshi', 'preview-quick-oshi');

        globalInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = (evt) => this.startCropper(evt.target.result);
                reader.readAsDataURL(e.target.files[0]);
            }
        });

        document.getElementById('btn-crop-confirm').addEventListener('click', () => {
            if (this.cropper) {
                const isSquare = this.activeCropTarget.includes('avatar') || this.activeCropTarget.includes('oshi');
                const canvas = this.cropper.getCroppedCanvas({ width: 600, height: isSquare ? 600 : 800 });
                const result = canvas.toDataURL('image/jpeg', 0.85);
                const img = document.getElementById(this.activeCropTarget);
                img.src = result; 
                img.style.display = 'block';
                const ph = img.parentElement.querySelector('.placeholder');
                if(ph) ph.style.display = 'none';
                this.closeCropper();
            }
        });
        document.getElementById('btn-crop-cancel').addEventListener('click', () => this.closeCropper());

        // 保存实体
        document.getElementById('btn-save-game-trigger').addEventListener('click', () => this.saveGame());
        document.getElementById('btn-save-oshi-trigger').addEventListener('click', () => this.saveOshi());

        // 详情页功能
        document.getElementById('btn-add-oshi-from-game').addEventListener('click', () => {
            const gameName = document.getElementById('detail-game-name').innerText;
            const game = this.data.games.find(g => g.name === gameName);
            if(game) {
                document.getElementById('sheet-game-detail').classList.remove('active');
                this.openOshiForm(null, game.id);
            }
        });
    },

    exportBackup: function() {
        const backup = {
            version: 1,
            date: new Date().toISOString(),
            games: this.data.games,
            oshi: this.data.oshi,
            settings: {
                name: localStorage.getItem('gamnee_username'),
                bio: localStorage.getItem('gamnee_bio'),
                avatar: localStorage.getItem('gamnee_avatar')
            }
        };
        const blob = new Blob([JSON.stringify(backup)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Gamnee_Backup_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
    },

    importBackup: function(e) {
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const data = JSON.parse(evt.target.result);
                if(data.games) {
                    await db.clear('games');
                    for(const g of data.games) await db.put('games', g);
                }
                if(data.oshi) {
                    await db.clear('oshi');
                    for(const o of data.oshi) await db.put('oshi', o);
                }
                if(data.settings) {
                    if(data.settings.name) localStorage.setItem('gamnee_username', data.settings.name);
                    if(data.settings.bio) localStorage.setItem('gamnee_bio', data.settings.bio);
                    if(data.settings.avatar) localStorage.setItem('gamnee_avatar', data.settings.avatar);
                }
                alert('数据恢复成功！');
                location.reload();
            } catch(error) {
                alert('文件格式错误');
            }
        };
        reader.readAsText(file);
    },

    startCropper: function(src) {
        document.getElementById('cropper-target-img').src = src;
        document.getElementById('cropper-overlay').classList.add('active');
        if (this.cropper) this.cropper.destroy();
        const isSquare = this.activeCropTarget.includes('avatar') || this.activeCropTarget.includes('oshi');
        this.cropper = new Cropper(document.getElementById('cropper-target-img'), {
            aspectRatio: isSquare ? 1 : 0.75,
            viewMode: 1, dragMode: 'move', autoCropArea: 1, background: false
        });
    },
    closeCropper: function() {
        document.getElementById('cropper-overlay').classList.remove('active');
        if(this.cropper) { this.cropper.destroy(); this.cropper = null; }
    },

    render: function(sortOrder = 'date') {
        const container = document.getElementById('app-container');
        const emptyState = document.getElementById('empty-state-view');
        container.innerHTML = '';
        
        let isEmpty = false;

        if (this.currentTab === 'oshi') {
            container.className = 'content-area oshi-grid';
            if (this.data.oshi.length === 0) isEmpty = true;
            else {
                this.data.oshi.forEach(o => container.appendChild(this.createOshiCard(o)));
            }
        } else if (this.currentTab === 'library') {
            container.className = 'content-area';
            let list = [...this.data.games];
            const kw = document.getElementById('lib-search').value.toLowerCase();
            if(kw) list = list.filter(g => g.name.toLowerCase().includes(kw));
            if(sortOrder === 'name') list.sort((a,b) => a.name.localeCompare(b.name));
            else if(sortOrder === 'status') list.sort((a,b) => a.status.localeCompare(b.status));
            if (list.length === 0) isEmpty = true;
            else list.forEach(g => container.appendChild(this.createGameCard(g)));
        } else {
            container.className = 'content-area';
            let list = this.data.games.filter(g => g.status === this.currentTab);
            if (list.length === 0) isEmpty = true;
            else list.forEach(g => container.appendChild(this.createGameCard(g)));
        }

        if (isEmpty) {
            container.style.display = 'none';
            emptyState.style.display = 'flex';
        } else {
            container.style.display = (this.currentTab === 'oshi') ? 'grid' : 'block';
            emptyState.style.display = 'none';
        }
    },

    createGameCard: function(g) {
        const div = document.createElement('div');
        div.className = 'game-card';
        div.innerHTML = `
            <img class="card-cover" src="${g.cover}">
            <div class="card-info">
                <div class="card-title">${g.name}</div>
                <div class="card-meta">
                    <span class="status-badge ${g.status}">${this.getStatusText(g.status)}</span>
                    <span>${g.platform || '全平台'}</span>
                    ${g.price ? `<span class="price-tag">¥${g.price}</span>` : ''}
                </div>
            </div>
        `;
        div.onclick = () => this.showGameDetail(g);
        return div;
    },

    createOshiCard: function(o) {
        const div = document.createElement('div');
        div.className = 'oshi-card';
        div.innerHTML = `
            <img src="${o.avatar}">
            <h4>${o.name}</h4>
            <div class="oshi-mini-tags">
                ${(o.tags||[]).slice(0,2).map(t => `<span>#${t}</span>`).join('')}
            </div>
        `;
        div.onclick = () => this.showOshiDetail(o);
        return div;
    },

    renderTagsInForm: function() {
        const div = document.getElementById('oshi-tags-display');
        div.innerHTML = '';
        this.tempTags.forEach((tag, idx) => {
            const span = document.createElement('span');
            span.className = 'tag-pill';
            span.innerHTML = `#${tag} <i class="ph ph-x"></i>`;
            span.onclick = () => {
                this.tempTags.splice(idx, 1);
                this.renderTagsInForm();
            };
            div.appendChild(span);
        });
    },

    openGameForm: function(game = null) {
        const form = document.getElementById('game-form');
        form.reset();
        document.getElementById('preview-game-cover').style.display = 'none';
        document.querySelector('#trigger-game-cover .placeholder').style.display = 'flex';
        
        document.getElementById('preview-quick-oshi').style.display = 'none';
        document.querySelector('#trigger-quick-oshi .placeholder').style.display = 'flex';

        document.querySelectorAll('.status-option').forEach(o => o.classList.remove('active'));

        if (game) {
            document.getElementById('game-id').value = game.id;
            document.getElementById('game-name').value = game.name;
            document.getElementById('game-platform').value = game.platform || '';
            document.getElementById('game-price').value = game.price || ''; 
            document.getElementById('game-start-date').value = game.startDate;
            document.getElementById('game-end-date').value = game.endDate;
            document.getElementById('game-note').value = game.note;
            document.getElementById('game-status').value = game.status;
            
            const activeOpt = document.querySelector(`.status-option[data-val="${game.status}"]`);
            if(activeOpt) activeOpt.classList.add('active');

            if(game.cover) {
                document.getElementById('preview-game-cover').src = game.cover;
                document.getElementById('preview-game-cover').style.display = 'block';
                document.querySelector('#trigger-game-cover .placeholder').style.display = 'none';
            }
            document.getElementById('quick-oshi-section').style.display = 'none';
        } else {
            document.querySelector('.status-option[data-val="wishlist"]').classList.add('active');
            document.getElementById('quick-oshi-section').style.display = 'block';
        }
        document.getElementById('sheet-game-form').classList.add('active');
    },

    saveGame: async function() {
        const name = document.getElementById('game-name').value;
        if (!name) return alert('请填写游戏名称');
        
        const idStr = document.getElementById('game-id').value;
        const newGameId = idStr ? parseInt(idStr) : Date.now();
        const data = {
            id: newGameId,
            name: name,
            status: document.getElementById('game-status').value,
            platform: document.getElementById('game-platform').value,
            price: document.getElementById('game-price').value,
            startDate: document.getElementById('game-start-date').value,
            endDate: document.getElementById('game-end-date').value,
            note: document.getElementById('game-note').value,
            cover: document.getElementById('preview-game-cover').src,
            createdAt: Date.now()
        };
        if (data.cover.includes('display:none')) data.cover = '';

        const quickOshiName = document.getElementById('quick-oshi-name').value;
        const quickOshiAvatar = document.getElementById('preview-quick-oshi').src;
        if (!idStr && quickOshiName && document.getElementById('quick-oshi-section').style.display !== 'none') {
            const oshiData = {
                id: Date.now() + 1,
                name: quickOshiName,
                gameId: newGameId,
                reason: '添加游戏时创建',
                avatar: quickOshiAvatar.includes('display:none') ? 'https://ui-avatars.com/api/?name='+quickOshiName : quickOshiAvatar,
                tags: []
            };
            await db.put('oshi', oshiData);
        }

        await db.put('games', data);
        document.getElementById('sheet-game-form').classList.remove('active');
        await this.loadData();
        this.render();
    },

    openOshiForm: function(oshi = null, prefillGameId = null) {
        const form = document.getElementById('oshi-form');
        form.reset();
        document.getElementById('preview-oshi-avatar').style.display = 'none';
        
        const sel = document.getElementById('oshi-game-select');
        sel.innerHTML = '<option value="">-- 无关联游戏 --</option>';
        this.data.games.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.id; opt.textContent = g.name;
            sel.appendChild(opt);
        });

        if(prefillGameId) sel.value = prefillGameId;

        if (oshi) {
            document.getElementById('oshi-id').value = oshi.id;
            document.getElementById('oshi-name').value = oshi.name;
            document.getElementById('oshi-reason').value = oshi.reason;
            sel.value = oshi.gameId || '';
            this.tempTags = oshi.tags || [];
            if (oshi.avatar) {
                document.getElementById('preview-oshi-avatar').src = oshi.avatar;
                document.getElementById('preview-oshi-avatar').style.display = 'block';
            }
        } else {
            this.tempTags = [];
        }
        this.renderTagsInForm();
        document.getElementById('sheet-oshi-form').classList.add('active');
    },

    saveOshi: async function() {
        const name = document.getElementById('oshi-name').value;
        if (!name) return alert('请填写角色名');
        
        const id = document.getElementById('oshi-id').value;
        const data = {
            id: id ? parseInt(id) : Date.now(),
            name: name,
            gameId: document.getElementById('oshi-game-select').value,
            reason: document.getElementById('oshi-reason').value,
            avatar: document.getElementById('preview-oshi-avatar').src,
            tags: this.tempTags
        };
        await db.put('oshi', data);
        document.getElementById('sheet-oshi-form').classList.remove('active');
        await this.loadData();
        this.render();
    },

    showGameDetail: function(g) {
        this.currentGameId = g.id;
        document.getElementById('detail-cover-img').src = g.cover || '';
        document.getElementById('detail-game-name').textContent = g.name;
        document.getElementById('detail-platform').textContent = g.platform || '-';
        document.getElementById('detail-status').textContent = this.getStatusText(g.status);
        document.getElementById('detail-price').textContent = g.price ? `¥${g.price}` : '-';
        document.getElementById('detail-dates').textContent = `${g.startDate || '?'} 至 ${g.endDate || '?'}`;
        document.getElementById('detail-note-text').textContent = g.note || '暂无备注';
        
        const relatedOshis = this.data.oshi.filter(o => o.gameId == g.id);
        const listEl = document.getElementById('detail-related-oshis');
        listEl.innerHTML = '';
        if(relatedOshis.length === 0) listEl.innerHTML = '<span class="text-muted" style="font-size:12px; color:#aaa;">暂无角色</span>';
        else {
            relatedOshis.forEach(o => {
                const item = document.createElement('div');
                item.className = 'detail-oshi-item';
                item.innerHTML = `<img src="${o.avatar}"><span>${o.name}</span>`;
                item.onclick = () => {
                    document.getElementById('sheet-game-detail').classList.remove('active');
                    this.showOshiDetail(o);
                };
                listEl.appendChild(item);
            });
        }

        document.getElementById('btn-edit-game').onclick = () => {
            document.getElementById('sheet-game-detail').classList.remove('active');
            this.openGameForm(g);
        };
        document.getElementById('btn-delete-game').onclick = async () => {
            if(confirm('确定删除?')) {
                await db.delete('games', g.id);
                document.getElementById('sheet-game-detail').classList.remove('active');
                await this.loadData();
                this.render();
            }
        };
        document.getElementById('sheet-game-detail').classList.add('active');
    },

    showOshiDetail: function(o) {
        document.getElementById('oshi-detail-img').src = o.avatar;
        document.getElementById('oshi-detail-title').textContent = o.name;
        
        const g = this.data.games.find(x => x.id == o.gameId);
        document.getElementById('oshi-detail-game-ref').textContent = g ? `来自: ${g.name}` : '';
        document.getElementById('oshi-detail-desc').textContent = o.reason || '...';
        
        const tagsDiv = document.getElementById('oshi-detail-tags');
        tagsDiv.innerHTML = (o.tags || []).map(t => `<span class="tag-pill sm">#${t}</span>`).join('');

        document.getElementById('btn-edit-oshi').onclick = () => {
            document.getElementById('sheet-oshi-detail').classList.remove('active');
            this.openOshiForm(o);
        };
        document.getElementById('btn-delete-oshi').onclick = async () => {
            await db.delete('oshi', o.id);
            document.getElementById('sheet-oshi-detail').classList.remove('active');
            await this.loadData();
            this.render();
        };
        document.getElementById('sheet-oshi-detail').classList.add('active');
    },

    wrapText: function(ctx, text, maxWidth) {
        return [];
    },

    getStatusText: (s) => ({'wishlist':'想玩','playing':'在玩','finished':'已玩'}[s] || s)
};

// ==========================================
// [核心重构] 推图生成器 v3.1 (独立排版)
// ==========================================
const Generator = {
    canvas: null,
    ctx: null,
    bgImage: null, // 存储背景图
    
    // 排版配置
    config: {
        showProfile: true,
        showPlaying: true,
        showFinished: true,
        showWishlist: false,
        showOshi: true,
        
        bgColor: '#faf9fe',
        bgImage: null, // 存储背景图对象
        cardOpacity: 1.0,
        
        // 独立排版模式
        gameColumns: 1, // 游戏排版：1=列表, 2=网格
        oshiColumns: 1, // 推し排版：1=列表, 2=网格
        
        // 画布基准参数 (高清导出)
        baseWidth: 750, 
        paddingX: 40,
        paddingY: 60,
        
        // 字体设置
        fontFamily: 'sans-serif',
        
        // 颜色
        colTitle: '#2d3436',
        colSub: '#636e72',
        colAccent: '#00b894',

        // 新增标题颜色
        titleColor: '#b2bec3'
    },
    
    init: function() {
        this.canvas = document.getElementById('gen-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.bindEvents();
        // 尝试加载上次的配置
        this.loadConfig();
    },

    loadConfig: function() {
        // 读取本地存储配置，恢复UI状态
        const saved = localStorage.getItem('gamnee_gen_config_v3');
        if(saved) {
            try {
                const parsed = JSON.parse(saved);
                // 兼容旧版配置：如果存在旧的columns字段，则同时赋值给gameColumns和oshiColumns
                if (parsed.columns !== undefined && parsed.gameColumns === undefined) {
                    parsed.gameColumns = parsed.columns;
                    parsed.oshiColumns = parsed.columns;
                }
                // 排除 bgImage 因为不能存 JSON
                delete parsed.bgImage; 
                Object.assign(this.config, parsed);
                this.syncUI();
            } catch(e) {}
        }
    },

    saveConfig: function() {
        const toSave = {...this.config};
        delete toSave.bgImage; // 不存图片对象
        localStorage.setItem('gamnee_gen_config_v3', JSON.stringify(toSave));
    },

    syncUI: function() {
        const setCheck = (id, val) => {
            const el = document.getElementById(id);
            if(el) el.checked = val;
        };
        setCheck('gen-check-profile', this.config.showProfile);
        setCheck('gen-check-playing', this.config.showPlaying);
        setCheck('gen-check-finished', this.config.showFinished);
        setCheck('gen-check-wishlist', this.config.showWishlist);
        setCheck('gen-check-oshi', this.config.showOshi);

        const colorPicker = document.getElementById('gen-bg-color');
        if(colorPicker) colorPicker.value = this.config.bgColor;

        const titleColorPicker = document.getElementById('gen-title-color');
        if(titleColorPicker) titleColorPicker.value = this.config.titleColor;

        const opacitySlider = document.getElementById('gen-card-opacity');
        if(opacitySlider) opacitySlider.value = this.config.cardOpacity;
        
        // 恢复游戏排版按钮状态
        const gameColBtns = document.querySelectorAll('.segment-btn[data-gamecol]');
        gameColBtns.forEach(btn => {
            if(parseInt(btn.dataset.gamecol) === this.config.gameColumns) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // 恢复推し排版按钮状态
        const oshiColBtns = document.querySelectorAll('.segment-btn[data-oshicol]');
        oshiColBtns.forEach(btn => {
            if(parseInt(btn.dataset.oshicol) === this.config.oshiColumns) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // 恢复字体按钮
        const fontBtns = document.querySelectorAll('.segment-btn[data-font]');
        fontBtns.forEach(btn => {
            if (btn.dataset.font === this.config.fontFamily) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        const resetBgBtn = document.getElementById('btn-gen-reset-bg');
        if(resetBgBtn) resetBgBtn.style.display = this.config.bgImage ? 'block' : 'none';
    },

    bindEvents: function() {
        // 1. 打开入口
        const fab = document.getElementById('fab-generator');
        if(fab) fab.onclick = () => {
            document.getElementById('sheet-generator').classList.add('active');
            this.draw(); // 打开即生成
        };

        const refresh = () => {
            this.saveConfig();
            this.draw();
        };

        // 2. 绑定复选框
        ['profile','playing','finished','wishlist','oshi'].forEach(key => {
            const el = document.getElementById(`gen-check-${key}`);
            if(el) el.onchange = (e) => {
                this.config['show'+key.charAt(0).toUpperCase()+key.slice(1)] = e.target.checked;
                refresh();
            };
        });

        // 3. 外观设置
        const bgPicker = document.getElementById('gen-bg-color');
        if(bgPicker) bgPicker.oninput = (e) => {
            this.config.bgColor = e.target.value;
            this.config.bgImage = null; // 颜色覆盖图片
            const resetBtn = document.getElementById('btn-gen-reset-bg');
            if(resetBtn) resetBtn.style.display = 'none';
            refresh();
        };

        const titleColorPicker = document.getElementById('gen-title-color');
        if(titleColorPicker) titleColorPicker.oninput = (e) => {
            this.config.titleColor = e.target.value;
            refresh();
        };

        const opacityRange = document.getElementById('gen-card-opacity');
        if(opacityRange) opacityRange.oninput = (e) => {
            this.config.cardOpacity = parseFloat(e.target.value);
            refresh();
        };

        // 游戏排版切换
        const gameColBtns = document.querySelectorAll('.segment-btn[data-gamecol]');
        gameColBtns.forEach(btn => {
            btn.onclick = (e) => {
                gameColBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.config.gameColumns = parseInt(e.target.dataset.gamecol);
                refresh();
            };
        });

        // 推し排版切换
        const oshiColBtns = document.querySelectorAll('.segment-btn[data-oshicol]');
        oshiColBtns.forEach(btn => {
            btn.onclick = (e) => {
                oshiColBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.config.oshiColumns = parseInt(e.target.dataset.oshicol);
                refresh();
            };
        });

        // 字体切换（使用通用名称）
        const fontBtns = document.querySelectorAll('.segment-btn[data-font]');
        fontBtns.forEach(btn => {
            btn.onclick = (e) => {
                fontBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.config.fontFamily = e.target.dataset.font;
                refresh();
            };
        });

        // 4. 背景图上传
        const bgBtn = document.getElementById('btn-gen-bg-img');
        const bgInput = document.getElementById('gen-bg-input');
        const bgReset = document.getElementById('btn-gen-reset-bg');

        if(bgBtn) bgBtn.onclick = () => bgInput.click();
        if(bgInput) bgInput.onchange = (e) => {
            const file = e.target.files[0];
            if(file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const img = new Image();
                    img.onload = () => {
                        this.config.bgImage = img;
                        if(bgReset) bgReset.style.display = 'inline-flex';
                        refresh();
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(file);
            }
        };
        if(bgReset) bgReset.onclick = () => {
            this.config.bgImage = null;
            bgReset.style.display = 'none';
            refresh();
        };

        // 5. 导出
        const exportBtn = document.getElementById('btn-export-image');
        if(exportBtn) exportBtn.onclick = () => {
            const link = document.createElement('a');
            link.download = `Gamnee_Share_${Date.now()}.png`;
            link.href = this.canvas.toDataURL('image/png', 1.0); // 最高质量
            link.click();
        };
    },

    // --- 核心绘制流程 ---
    draw: async function() {
        const user = {
            name: localStorage.getItem('gamnee_username') || 'Gamnée 玩家',
            bio: localStorage.getItem('gamnee_bio') || '暂无简介',
            avatar: localStorage.getItem('gamnee_avatar') || ''
        };

        // 筛选数据
        const games = (app.data.games || []).filter(g => {
            if(g.status === 'playing' && this.config.showPlaying) return true;
            if(g.status === 'finished' && this.config.showFinished) return true;
            if(g.status === 'wishlist' && this.config.showWishlist) return true;
            return false;
        });

        const oshis = this.config.showOshi ? (app.data.oshi || []) : [];

        // == 第一步：计算总高度 (虚拟排版) ==
        // 我们不实际画，只是跑一遍逻辑看看需要多高
        const totalHeight = await this.layoutEngine(user, games, oshis, true);

        // == 第二步：设置画布 ==
        this.canvas.width = this.config.baseWidth;
        this.canvas.height = totalHeight;
        
        // 绘制背景：如果有背景图片则只绘制图片，否则绘制纯色
        if(this.config.bgImage) {
            this.drawCoverBg(this.config.bgImage, totalHeight);
            // 不再叠加颜色蒙版，确保背景图片完全可见
        } else {
            this.ctx.fillStyle = this.config.bgColor;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // == 第三步：实际绘制 ==
        await this.layoutEngine(user, games, oshis, false);

        // Footer
        this.ctx.fillStyle = '#b2bec3';
        this.ctx.font = '500 24px ' + this.config.fontFamily;
        this.ctx.textAlign = 'center';
        this.ctx.fillText('Generated by Gamnée', this.canvas.width/2, totalHeight - 40);
    },

    // --- 智能排版引擎 (核心) ---
    // dryRun = true 时只返回高度，不画
    layoutEngine: async function(user, games, oshis, dryRun) {
        let cursorY = this.config.paddingY;
        const contentW = this.config.baseWidth - (this.config.paddingX * 2);

        // 1. 个人资料卡片
        if(this.config.showProfile) {
            const h = await this.renderProfileCard(user, this.config.paddingX, cursorY, contentW, dryRun);
            cursorY += h + 40; // 卡片间距
        }

        // 2. 游戏列表（使用游戏独立排版）
        if(games.length > 0) {
            if(!dryRun) this.drawSectionTitle('GAME RECORDS', cursorY);
            cursorY += 80;

            if(this.config.gameColumns === 1) {
                // 单列模式
                for(let g of games) {
                    const h = await this.renderGameCardSingle(g, this.config.paddingX, cursorY, contentW, dryRun);
                    cursorY += h + 30;
                }
            } else {
                // 双列模式
                const gap = 30;
                const colW = (contentW - gap) / 2;
                for(let i=0; i<games.length; i+=2) {
                    const g1 = games[i];
                    const g2 = games[i+1];
                    
                    // 并行计算两个卡片的高度，取最大值作为行高
                    const h1 = await this.renderGameCardGrid(g1, this.config.paddingX, cursorY, colW, true);
                    const h2 = g2 ? await this.renderGameCardGrid(g2, this.config.paddingX + colW + gap, cursorY, colW, true) : 0;
                    
                    const rowH = Math.max(h1, h2);

                    if(!dryRun) {
                        await this.renderGameCardGrid(g1, this.config.paddingX, cursorY, colW, false, rowH);
                        if(g2) await this.renderGameCardGrid(g2, this.config.paddingX + colW + gap, cursorY, colW, false, rowH);
                    }
                    cursorY += rowH + 30;
                }
            }
            cursorY += 20;
        }

        // 3. 推し列表（使用推し独立排版）
        if(oshis.length > 0) {
            if(!dryRun) this.drawSectionTitle('MY OSHI', cursorY);
            cursorY += 80;

            if(this.config.oshiColumns === 1) {
                for(let o of oshis) {
                    const h = await this.renderOshiCardSingle(o, this.config.paddingX, cursorY, contentW, dryRun);
                    cursorY += h + 30;
                }
            } else {
                const gap = 30;
                const colW = (contentW - gap) / 2;
                for(let i=0; i<oshis.length; i+=2) {
                    const o1 = oshis[i];
                    const o2 = oshis[i+1];
                    
                    const h1 = await this.renderOshiCardGrid(o1, this.config.paddingX, cursorY, colW, true);
                    const h2 = o2 ? await this.renderOshiCardGrid(o2, this.config.paddingX + colW + gap, cursorY, colW, true) : 0;
                    const rowH = Math.max(h1, h2);

                    if(!dryRun) {
                        await this.renderOshiCardGrid(o1, this.config.paddingX, cursorY, colW, false, rowH);
                        if(o2) await this.renderOshiCardGrid(o2, this.config.paddingX + colW + gap, cursorY, colW, false, rowH);
                    }
                    cursorY += rowH + 30;
                }
            }
            cursorY += 20;
        }

        return cursorY + 100; // 底部留白
    },

    // --- 卡片渲染器 (负责计算和绘制) ---

    // 1. 个人资料 (自适应高度)
    renderProfileCard: async function(u, x, y, w, dryRun) {
        // 布局参数
        const avatarSize = 120;
        const padding = 40;
        const textStart = x + padding + avatarSize + 30; // 文字绝对不跨过这条线
        const textW = (x + w) - textStart - padding; // 文字可用宽度

        // 预计算文字高度
        this.ctx.font = 'bold 48px ' + this.config.fontFamily;
        const nameH = 48; 
        
        this.ctx.font = '30px ' + this.config.fontFamily;
        // bioHeight 自动计算行数
        const bioLines = this.getWrapLines(u.bio, textW); 
        const bioH = bioLines.length * 42; 

        // 卡片总高度 = 上内边距 + 头像或文字的最大高度 + 下内边距
        const contentH = Math.max(avatarSize, nameH + 20 + bioH);
        const cardH = padding + contentH + padding;

        if(!dryRun) {
            this.drawCardBase(x, y, w, cardH);
            
            // 头像垂直居中
            const avatarY = y + (cardH - avatarSize)/2;
            await this.drawCircleImg(u.avatar, x + padding, avatarY, avatarSize);

            // 绘制文字
            let textY = y + padding + 40; // 基线
            
            this.ctx.textAlign = 'left';
            this.ctx.fillStyle = this.config.colTitle;
            this.ctx.font = 'bold 48px ' + this.config.fontFamily;
            this.ctx.fillText(u.name, textStart, textY);

            textY += 50;
            this.ctx.fillStyle = this.config.colSub;
            this.ctx.font = '30px ' + this.config.fontFamily;
            
            for(let line of bioLines) {
                this.ctx.fillText(line, textStart, textY);
                textY += 42;
            }
        }
        return cardH;
    },

    // 2. 游戏单列 (左图右文，绝对不重叠)
    renderGameCardSingle: async function(g, x, y, w, dryRun) {
        const padding = 30;
        const coverW = 140;
        const coverH = 186; // 3:4 比例
        const textLeft = x + padding + coverW + 30; // 文字起始X
        const textW = (x + w) - textLeft - padding;

        this.ctx.font = 'bold 36px ' + this.config.fontFamily;
        const titleLines = this.getWrapLines(g.name, textW);
        const titleH = titleLines.length * 46;

        const badgeH = 40;
        const platH = 30;

        // 计算高度：取图片高度 和 文字堆叠高度 的最大值
        const textTotalH = titleH + 20 + badgeH + 20 + platH;
        const contentH = Math.max(coverH, textTotalH);
        const cardH = padding + contentH + padding;

        if(!dryRun) {
            this.drawCardBase(x, y, w, cardH);
            
            // 封面垂直居中
            const imgY = y + (cardH - coverH)/2;
            await this.drawRoundedImg(g.cover, x + padding, imgY, coverW, coverH, 12);

            let cursor = y + padding + 36; // 第一行文字基线
            // 如果文字总高度比图片矮很多，就把文字整体往下移一点，好看
            if(textTotalH < coverH) cursor += (coverH - textTotalH) / 3;

            this.ctx.fillStyle = this.config.colTitle;
            this.ctx.font = 'bold 36px ' + this.config.fontFamily;
            for(let line of titleLines) {
                this.ctx.fillText(line, textLeft, cursor);
                cursor += 46;
            }

            cursor += 10;
            // 状态标
            const status = this.getStatusConfig(g.status);
            this.drawBadge(status.text, textLeft, cursor - 24, status.bg, status.col);

            cursor += 60; // 增加间距，让平台文字更远
            this.ctx.fillStyle = '#999';
            this.ctx.font = '26px ' + this.config.fontFamily;
            this.ctx.fillText(g.platform || '全平台', textLeft, cursor);
        }
        return cardH;
    },

    // 3. 游戏网格 (上图下文)
    renderGameCardGrid: async function(g, x, y, w, dryRun, fixedHeight) {
        const coverH = w * 1.33; // 3:4 封面
        const padding = 24;
        
        this.ctx.font = 'bold 32px ' + this.config.fontFamily;
        const titleLines = this.getWrapLines(g.name, w - padding*2);
        const titleH = titleLines.length * 40;

        // 自然高度
        const naturalH = coverH + padding + titleH + 20 + 40 + padding;
        const cardH = fixedHeight || naturalH; // 如果强制指定高度(为了对齐)，就用强制的

        if(!dryRun) {
            this.drawCardBase(x, y, w, cardH);
            // 图片占满顶部，切圆角仅上面
            await this.drawRoundedImg(g.cover, x, y, w, coverH, {tl:20, tr:20, bl:0, br:0});

            let cursor = y + coverH + padding + 24;
            this.ctx.fillStyle = this.config.colTitle;
            this.ctx.font = 'bold 32px ' + this.config.fontFamily;
            for(let line of titleLines) {
                this.ctx.fillText(line, x + padding, cursor);
                cursor += 40;
            }

            cursor += 10;
            const status = this.getStatusConfig(g.status);
            this.drawBadge(status.text, x + padding, cursor - 24, status.bg, status.col, 22);
        }
        return naturalH;
    },

    // 4. 推し单列
    renderOshiCardSingle: async function(o, x, y, w, dryRun) {
        const padding = 30;
        const size = 120; // 头像大一点
        const textLeft = x + padding + size + 30;
        const textW = (x + w) - textLeft - padding;

        this.ctx.font = 'bold 40px ' + this.config.fontFamily;
        const nameH = 40;
        
        // 标签行
        const tagH = (o.tags && o.tags.length) ? 40 : 0;
        
        const contentH = Math.max(size, nameH + (tagH ? 20 + tagH : 0));
        const cardH = padding + contentH + padding;

        if(!dryRun) {
            this.drawCardBase(x, y, w, cardH);
            const imgY = y + (cardH - size)/2;
            await this.drawCircleImg(o.avatar, x + padding, imgY, size);

            let cursor = y + padding + 35;
            // 垂直居中修正
            if(contentH < size) cursor += (size - contentH)/2;

            this.ctx.fillStyle = this.config.colTitle;
            this.ctx.font = 'bold 40px ' + this.config.fontFamily;
            this.ctx.fillText(o.name, textLeft, cursor);

            if(o.tags && o.tags.length) {
                cursor += 50;
                let tx = textLeft;
                o.tags.slice(0, 3).forEach(t => {
                    const tagText = '#' + t;
                    const tagWidth = this.ctx.measureText(tagText).width;
                    // 内边距改为12px，使标签更紧凑
                    const badgeWidth = tagWidth + 16;
                    this.drawBadge(tagText, tx, cursor - 24, '#fff0f5', '#d63384', 20);
                    tx += badgeWidth + 10; // 间距10px
                });
            }
        }
        return cardH;
    },

    // 5. 推し网格
    renderOshiCardGrid: async function(o, x, y, w, dryRun, fixedHeight) {
        const padding = 24;
        const avatarSize = 140;
        
        this.ctx.font = 'bold 32px ' + this.config.fontFamily;
        const nameLines = this.getWrapLines(o.name, w - padding*2);
        const nameH = nameLines.length * 40;

        const naturalH = padding + avatarSize + 20 + nameH + 20 + 30 + padding;
        const cardH = fixedHeight || naturalH;

        if(!dryRun) {
            this.drawCardBase(x, y, w, cardH);
            
            const centerX = x + w/2;
            await this.drawCircleImg(o.avatar, centerX - avatarSize/2, y + padding, avatarSize);

            let cursor = y + padding + avatarSize + 40;
            this.ctx.textAlign = 'center';
            this.ctx.fillStyle = this.config.colTitle;
            this.ctx.font = 'bold 32px ' + this.config.fontFamily;
            
            for(let line of nameLines) {
                this.ctx.fillText(line, centerX, cursor);
                cursor += 40;
            }

            if(o.tags && o.tags.length) {
                cursor += 10;
                // 只显示第一个tag，紧凑显示
                this.ctx.textAlign = 'left';
                const tagTxt = '#' + o.tags[0];
                this.ctx.font = '22px ' + this.config.fontFamily;
                const tw = this.ctx.measureText(tagTxt).width + 16; // 内边距减小
                this.drawBadge(tagTxt, centerX - tw/2, cursor - 24, '#fff0f5', '#d63384', 20);
            }
            this.ctx.textAlign = 'left';
        }
        return naturalH;
    },

    // --- 核心工具函数 ---

    // 自动换行计算：返回字符串数组
    getWrapLines: function(text, maxWidth) {
        if(!text) return [];
        const words = text.split('');
        const lines = [];
        let currentLine = words[0];

        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = this.ctx.measureText(currentLine + word).width;
            if (width < maxWidth) {
                currentLine += word;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        lines.push(currentLine);
        return lines;
    },

    drawCardBase: function(x, y, w, h) {
        this.ctx.save();
        this.ctx.globalAlpha = this.config.cardOpacity;
        this.ctx.shadowColor = 'rgba(0,0,0,0.04)';
        this.ctx.shadowBlur = 16;
        this.ctx.shadowOffsetY = 4;
        this.ctx.fillStyle = '#fff';
        this.roundRect(x, y, w, h, 20);
        this.ctx.fill();
        this.ctx.restore();
    },

    drawBadge: function(text, x, y, bg, col, size=24) {
        this.ctx.save();
        this.ctx.font = size + 'px ' + this.config.fontFamily;
        const w = this.ctx.measureText(text).width + 16; // 减小内边距
        const h = size + 10; // 高度相应减小
        this.ctx.fillStyle = bg;
        this.roundRect(x, y, w, h, 8);
        this.ctx.fill();
        this.ctx.fillStyle = col;
        this.ctx.fillText(text, x + 8, y + size + 2);
        this.ctx.restore();
    },

    drawSectionTitle: function(text, y) {
        this.ctx.save();
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = this.config.titleColor;
        this.ctx.font = 'bold 32px ' + this.config.fontFamily;
        this.ctx.letterSpacing = '4px';
        this.ctx.fillText(`— ${text} —`, this.canvas.width/2, y + 40);
        this.ctx.restore();
    },

    drawCoverBg: function(img, h) {
        const w = this.canvas.width;
        const scale = Math.max(w/img.width, h/img.height);
        const tx = (w - img.width*scale)/2;
        const ty = (h - img.height*scale)/2;
        this.ctx.drawImage(img, tx, ty, img.width*scale, img.height*scale);
    },

    roundRect: function(x, y, w, h, r) {
        if(typeof r === 'number') r = {tl:r, tr:r, br:r, bl:r};
        this.ctx.beginPath();
        this.ctx.moveTo(x + r.tl, y);
        this.ctx.lineTo(x + w - r.tr, y);
        this.ctx.quadraticCurveTo(x + w, y, x + w, y + r.tr);
        this.ctx.lineTo(x + w, y + h - r.br);
        this.ctx.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
        this.ctx.lineTo(x + r.bl, y + h);
        this.ctx.quadraticCurveTo(x, y + h, x, y + h - r.bl);
        this.ctx.lineTo(x, y + r.tl);
        this.ctx.quadraticCurveTo(x, y, x + r.tl, y);
        this.ctx.closePath();
    },

    // 图片加载缓存
    imgCache: {},
    loadImage: function(src) {
        if(!src) return Promise.resolve(null);
        if(this.imgCache[src]) return Promise.resolve(this.imgCache[src]);
        
        return new Promise(r => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => { this.imgCache[src] = img; r(img); };
            img.onerror = () => r(null);
            img.src = src;
        });
    },

    drawCircleImg: async function(src, x, y, size) {
        const img = await this.loadImage(src);
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(x + size/2, y + size/2, size/2, 0, Math.PI*2);
        this.ctx.clip();
        if(img) this.ctx.drawImage(img, x, y, size, size);
        else { this.ctx.fillStyle='#eee'; this.ctx.fillRect(x,y,size,size); }
        this.ctx.restore();
    },

    drawRoundedImg: async function(src, x, y, w, h, r) {
        const img = await this.loadImage(src);
        this.ctx.save();
        this.roundRect(x, y, w, h, r);
        this.ctx.clip();
        if(img) {
            const scale = Math.max(w/img.width, h/img.height);
            const tx = (w - img.width*scale)/2;
            const ty = (h - img.height*scale)/2;
            this.ctx.drawImage(img, x+tx, y+ty, img.width*scale, img.height*scale);
        } else {
            this.ctx.fillStyle='#eee'; this.ctx.fillRect(x,y,w,h);
        }
        this.ctx.restore();
    },

    hexToRgba: (hex, alpha) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    },

    getStatusConfig: (s) => ({
        'wishlist': {text:'想玩', bg:'#fff8e1', col:'#fbc02d'},
        'playing': {text:'在玩', bg:'#e0f2f1', col:'#009688'},
        'finished': {text:'已玩', bg:'#e8f5e9', col:'#4caf50'}
    }[s] || {text:s, bg:'#eee', col:'#666'})
};

// 启动
window.addEventListener('load', () => {
    app.init();
    Generator.init();
});