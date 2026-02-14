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

        document.getElementById('lib-search').addEventListener('input', () => this.render());
        let sortOrder = 'date'; 
        document.getElementById('btn-sort').addEventListener('click', () => {
            if(sortOrder === 'date') sortOrder = 'name';
            else if(sortOrder === 'name') sortOrder = 'status';
            else sortOrder = 'date';
            this.render(sortOrder);
        });

        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById(btn.dataset.close).classList.remove('active');
            });
        });

        document.getElementById('fab-add').addEventListener('click', () => {
            this.currentTab === 'oshi' ? this.openOshiForm() : this.openGameForm();
        });

        document.getElementById('btn-settings').addEventListener('click', () => {
            document.getElementById('sheet-settings').classList.add('active');
        });
        document.getElementById('btn-save-settings').addEventListener('click', () => {
            localStorage.setItem('gamnee_username', document.getElementById('user-name-input').value);
            localStorage.setItem('gamnee_bio', document.getElementById('user-bio-input').value);
            localStorage.setItem('gamnee_avatar', document.getElementById('preview-user-avatar').src);
            alert('设置已保存');
            document.getElementById('sheet-settings').classList.remove('active');
            if(Generator) Generator.draw(); 
        });
        document.getElementById('btn-backup-export').addEventListener('click', () => this.exportBackup());
        document.getElementById('btn-backup-import-trigger').addEventListener('click', () => {
            if(confirm('恢复数据将覆盖当前所有数据，确定吗？')) {
                document.getElementById('backup-file-input').click();
            }
        });
        document.getElementById('backup-file-input').addEventListener('change', (e) => this.importBackup(e));

        document.querySelectorAll('.status-option').forEach(opt => {
            opt.addEventListener('click', () => {
                document.querySelectorAll('.status-option').forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                document.getElementById('game-status').value = opt.dataset.val;
            });
        });

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

        document.getElementById('btn-save-game-trigger').addEventListener('click', () => this.saveGame());
        document.getElementById('btn-save-oshi-trigger').addEventListener('click', () => this.saveOshi());

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
        
        // 强制清空隐藏的 ID，防止新增变成覆盖
        document.getElementById('game-id').value = ''; 

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
            // 新增状态，默认选中当前 Tab 对应的状态
            let defaultStatus = this.currentTab === 'library' || this.currentTab === 'oshi' ? 'wishlist' : this.currentTab;
            document.querySelector(`.status-option[data-val="${defaultStatus}"]`).classList.add('active');
            document.getElementById('game-status').value = defaultStatus;
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
        
        // 同理修复
        document.getElementById('oshi-id').value = '';

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
            if(confirm('确定删除推し?')) {
                await db.delete('oshi', o.id);
                document.getElementById('sheet-oshi-detail').classList.remove('active');
                await this.loadData();
                this.render();
            }
        };
        document.getElementById('sheet-oshi-detail').classList.add('active');
    },

    getStatusText: (s) => ({'wishlist':'想玩','playing':'在玩','finished':'已玩'}[s] || s)
};

// ==========================================
// [终极重构] 推图生成器 v4.5 (丝滑修复版)
// ==========================================
const Generator = {
    canvas: null,
    ctx: null,
    
    // 基础配置
    config: {
        showProfile: true, showPlaying: true, showFinished: true, showWishlist: false, showOshi: true,
        bgColor: '#f4f6f9', bgImage: null, cardOpacity: 1.0,
        gameColumns: 1, oshiColumns: 1,
        
        baseWidth: 1080, 
        paddingX: 50,
        paddingY: 80, 
        fontFamily: 'sans-serif',
        colTitle: '#2d3436', colSub: '#636e72', titleColor: '#a4b0be'
    },
    
    // 防抖定时器
    _drawTimer: null,
    
    init: function() {
        this.canvas = document.getElementById('gen-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.bindEvents();
        this.loadConfig();
    },

    loadConfig: function() {
        const saved = localStorage.getItem('gamnee_gen_config_v4');
        if(saved) {
            try {
                const parsed = JSON.parse(saved);
                delete parsed.bgImage; 
                Object.assign(this.config, parsed);
                this.syncUI();
            } catch(e) {}
        }
    },

    saveConfig: function() {
        const toSave = {...this.config};
        delete toSave.bgImage; 
        localStorage.setItem('gamnee_gen_config_v4', JSON.stringify(toSave));
    },

    syncUI: function() {
        const setCheck = (id, val) => { const el = document.getElementById(id); if(el) el.checked = val; };
        setCheck('gen-check-profile', this.config.showProfile);
        setCheck('gen-check-playing', this.config.showPlaying);
        setCheck('gen-check-finished', this.config.showFinished);
        setCheck('gen-check-wishlist', this.config.showWishlist);
        setCheck('gen-check-oshi', this.config.showOshi);

        if(document.getElementById('gen-bg-color')) document.getElementById('gen-bg-color').value = this.config.bgColor;
        if(document.getElementById('gen-title-color')) document.getElementById('gen-title-color').value = this.config.titleColor;
        if(document.getElementById('gen-card-opacity')) document.getElementById('gen-card-opacity').value = this.config.cardOpacity;
        
        const syncSegment = (selector, val) => {
            document.querySelectorAll(selector).forEach(btn => {
                btn.classList.toggle('active', btn.dataset.val == val);
            });
        };
        syncSegment('.segment-btn[data-type="gamecol"]', this.config.gameColumns);
        syncSegment('.segment-btn[data-type="oshicol"]', this.config.oshiColumns);
        syncSegment('.segment-btn[data-type="font"]', this.config.fontFamily);

        const resetBgBtn = document.getElementById('btn-gen-reset-bg');
        if(resetBgBtn) resetBgBtn.style.display = this.config.bgImage ? 'inline-flex' : 'none';
    },

    bindEvents: function() {
        // --- 1. 拖拽面板手势控制（增加活动状态检查和阻止滚动）---
        const container = document.getElementById('gen-controls-container');
        const handle = document.getElementById('gen-drag-handle');
        const sheet = document.getElementById('sheet-generator');
        let startY = 0;
        let startHeight = 0;
        let isDragging = false;

        const isGeneratorActive = () => sheet && sheet.classList.contains('active');

        const onDragStart = (e) => {
            if (!isGeneratorActive()) return;
            isDragging = true;
            startY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
            startHeight = container.getBoundingClientRect().height;
            container.style.transition = 'none';
            document.body.style.userSelect = 'none';
        };

        const onDragMove = (e) => {
            if (!isDragging || !isGeneratorActive()) return;
            // 阻止页面滚动
            if (e.cancelable) e.preventDefault();
            const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
            const deltaY = startY - clientY; // 往上滑为正
            let newHeight = startHeight + deltaY;
            // 限制在 min/max 之间（vh换算）
            const vh = (newHeight / window.innerHeight) * 100;
            if (vh < 15) newHeight = window.innerHeight * 0.15;
            if (vh > 85) newHeight = window.innerHeight * 0.85;
            container.style.height = `${newHeight}px`;
        };

        const onDragEnd = () => {
            if (!isDragging) return;
            isDragging = false;
            container.style.transition = 'height 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';
            document.body.style.userSelect = '';
        };

        if (handle && container) {
            // 使用被动监听启动，但移动时主动调用 preventDefault
            handle.addEventListener('touchstart', onDragStart, { passive: true });
            handle.addEventListener('mousedown', onDragStart);
            document.addEventListener('touchmove', onDragMove, { passive: false });
            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('touchend', onDragEnd);
            document.addEventListener('mouseup', onDragEnd);
        }

        // --- 2. 传统表单交互绑定（使用 requestAnimationFrame 防抖）---
        const fab = document.getElementById('fab-generator');
        if(fab) fab.onclick = () => {
            document.getElementById('sheet-generator').classList.add('active');
            this.draw(); 
        };

        // 防抖刷新
        const refresh = () => {
            if (this._drawTimer) cancelAnimationFrame(this._drawTimer);
            this._drawTimer = requestAnimationFrame(() => {
                this.saveConfig();
                this.draw();
            });
        };

        ['profile','playing','finished','wishlist','oshi'].forEach(key => {
            const el = document.getElementById(`gen-check-${key}`);
            if(el) el.onchange = (e) => { this.config['show'+key.charAt(0).toUpperCase()+key.slice(1)] = e.target.checked; refresh(); };
        });

        const bgColor = document.getElementById('gen-bg-color');
        if(bgColor) bgColor.oninput = (e) => {
            this.config.bgColor = e.target.value;
            this.config.bgImage = null; 
            document.getElementById('btn-gen-reset-bg').style.display = 'none';
            refresh();
        };

        const titleColor = document.getElementById('gen-title-color');
        if(titleColor) titleColor.oninput = (e) => { this.config.titleColor = e.target.value; refresh(); };

        const opacityRange = document.getElementById('gen-card-opacity');
        if(opacityRange) opacityRange.oninput = (e) => { this.config.cardOpacity = parseFloat(e.target.value); refresh(); };

        const bindSegment = (selector, key, parser = v=>v) => {
            const btns = document.querySelectorAll(selector);
            btns.forEach(btn => {
                btn.onclick = (e) => {
                    btns.forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    this.config[key] = parser(e.target.dataset.val);
                    refresh();
                };
            });
        };
        bindSegment('.segment-btn[data-type="gamecol"]', 'gameColumns', parseInt);
        bindSegment('.segment-btn[data-type="oshicol"]', 'oshiColumns', parseInt);
        bindSegment('.segment-btn[data-type="font"]', 'fontFamily');

        const bgBtn = document.getElementById('btn-gen-bg-img');
        const bgInput = document.getElementById('gen-bg-input');
        const bgReset = document.getElementById('btn-gen-reset-bg');

        if(bgBtn) bgBtn.onclick = () => bgInput.click();
        if(bgInput) bgInput.onchange = (e) => {
            if(e.target.files[0]) {
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
                reader.readAsDataURL(e.target.files[0]);
            }
            bgInput.value = ''; 
        };
        if(bgReset) bgReset.onclick = () => {
            this.config.bgImage = null; 
            bgReset.style.display = 'none'; 
            refresh();
        };

        const exportBtn = document.getElementById('btn-export-image');
        if(exportBtn) exportBtn.onclick = () => {
            const link = document.createElement('a');
            link.download = `Gamnee_Share_${Date.now()}.png`;
            link.href = this.canvas.toDataURL('image/png', 1.0); 
            link.click();
        };
    },

    // --- 渲染引擎 ---
    draw: async function() {
        const user = {
            name: localStorage.getItem('gamnee_username') || 'Gamnée 玩家',
            bio: localStorage.getItem('gamnee_bio') || '这名玩家很懒，什么也没写。',
            avatar: localStorage.getItem('gamnee_avatar') || ''
        };

        const games = (app.data.games || []).filter(g => {
            if(g.status === 'playing' && this.config.showPlaying) return true;
            if(g.status === 'finished' && this.config.showFinished) return true;
            if(g.status === 'wishlist' && this.config.showWishlist) return true;
            return false;
        });
        const oshis = this.config.showOshi ? (app.data.oshi || []) : [];

        // 1. 获取动态高度 (干跑)
        const totalHeight = await this.layoutEngine(user, games, oshis, true);

        // 2. 设置画布真实像素
        this.canvas.width = this.config.baseWidth;
        this.canvas.height = totalHeight;
        
        // 背景绘制
        if(this.config.bgImage) {
            this.drawCoverBg(this.config.bgImage, totalHeight);
        } else {
            this.ctx.fillStyle = this.config.bgColor;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // 3. 真实渲染
        await this.layoutEngine(user, games, oshis, false);

        // 底部水印
        this.ctx.fillStyle = '#b2bec3';
        this.ctx.font = '500 28px ' + this.config.fontFamily;
        this.ctx.textAlign = 'center';
        this.ctx.fillText('Generated by Gamnée PWA', this.canvas.width/2, totalHeight - 40);
    },

    layoutEngine: async function(user, games, oshis, dryRun) {
        let cursorY = this.config.paddingY;
        const contentW = this.config.baseWidth - (this.config.paddingX * 2);
        const CARD_GAP = 40; // 卡片间距

        // 1. Profile
        if(this.config.showProfile) {
            const h = await this.renderProfileCard(user, this.config.paddingX, cursorY, contentW, dryRun);
            cursorY += h + 60; 
        }

        // 2. Games
        if(games.length > 0) {
            if(!dryRun) this.drawSectionTitle('GAME RECORD', cursorY);
            cursorY += 100;

            if(this.config.gameColumns === 1) {
                for(let g of games) {
                    const h = await this.renderGameCardSingle(g, this.config.paddingX, cursorY, contentW, dryRun);
                    cursorY += h + CARD_GAP;
                }
            } else {
                const colGap = 40;
                const colW = (contentW - colGap) / 2;
                for(let i=0; i<games.length; i+=2) {
                    const h1 = await this.renderGameCardGrid(games[i], this.config.paddingX, cursorY, colW, true);
                    const h2 = games[i+1] ? await this.renderGameCardGrid(games[i+1], 0, 0, colW, true) : 0;
                    const rowH = Math.max(h1, h2);

                    if(!dryRun) {
                        await this.renderGameCardGrid(games[i], this.config.paddingX, cursorY, colW, false, rowH);
                        if(games[i+1]) await this.renderGameCardGrid(games[i+1], this.config.paddingX + colW + colGap, cursorY, colW, false, rowH);
                    }
                    cursorY += rowH + CARD_GAP;
                }
            }
            cursorY += 40;
        }

        // 3. Oshi
        if(oshis.length > 0) {
            if(!dryRun) this.drawSectionTitle('MY OSHI', cursorY);
            cursorY += 100;

            if(this.config.oshiColumns === 1) {
                for(let o of oshis) {
                    const h = await this.renderOshiCardSingle(o, this.config.paddingX, cursorY, contentW, dryRun);
                    cursorY += h + CARD_GAP;
                }
            } else {
                const colGap = 40;
                const colW = (contentW - colGap) / 2;
                for(let i=0; i<oshis.length; i+=2) {
                    const h1 = await this.renderOshiCardGrid(oshis[i], this.config.paddingX, cursorY, colW, true);
                    const h2 = oshis[i+1] ? await this.renderOshiCardGrid(oshis[i+1], 0, 0, colW, true) : 0;
                    const rowH = Math.max(h1, h2);

                    if(!dryRun) {
                        await this.renderOshiCardGrid(oshis[i], this.config.paddingX, cursorY, colW, false, rowH);
                        if(oshis[i+1]) await this.renderOshiCardGrid(oshis[i+1], this.config.paddingX + colW + colGap, cursorY, colW, false, rowH);
                    }
                    cursorY += rowH + CARD_GAP;
                }
            }
        }

        return cursorY + 120; // 底部留白
    },

    // --- 组件绘制 (优化阴影与圆角参数) ---

    renderProfileCard: async function(u, x, y, w, dryRun) {
        const pad = 50;
        const avatarSize = 160;
        const textX = x + pad + avatarSize + 40;
        const textW = w - (textX - x) - pad;

        this.ctx.font = `bold 60px ${this.config.fontFamily}`;
        const nameH = 60; 
        
        this.ctx.font = `36px ${this.config.fontFamily}`;
        const bioLines = this.getWrapLines(u.bio, textW); 
        const bioH = bioLines.length * 52; 

        const contentH = Math.max(avatarSize, nameH + 20 + bioH);
        const cardH = pad + contentH + pad;

        if(!dryRun) {
            this.drawCardBase(x, y, w, cardH);
            await this.drawCircleImg(u.avatar, x + pad, y + (cardH-avatarSize)/2, avatarSize);

            let tY = y + pad + 55;
            if (contentH < avatarSize) tY += (avatarSize - contentH) / 2; // 文字太少时垂直居中对齐头像

            this.ctx.textAlign = 'left';
            this.ctx.fillStyle = this.config.colTitle;
            this.ctx.font = `bold 60px ${this.config.fontFamily}`;
            this.ctx.fillText(u.name, textX, tY);

            tY += 65;
            this.ctx.fillStyle = this.config.colSub;
            this.ctx.font = `36px ${this.config.fontFamily}`;
            for(let line of bioLines) {
                this.ctx.fillText(line, textX, tY);
                tY += 52;
            }
        }
        return cardH;
    },

    renderGameCardSingle: async function(g, x, y, w, dryRun) {
        const pad = 40;
        const coverW = 200, coverH = 266; 
        const textX = x + pad + coverW + 40; 
        const textW = w - (textX - x) - pad;

        this.ctx.font = `bold 48px ${this.config.fontFamily}`;
        const titleLines = this.getWrapLines(g.name, textW);
        const titleH = titleLines.length * 60;

        const textTotalH = titleH + 20 + 44 + 30 + 34; // 标题 + 间距 + Badge + 间距 + 平台
        const cardH = pad + Math.max(coverH, textTotalH) + pad;

        if(!dryRun) {
            this.drawCardBase(x, y, w, cardH);
            await this.drawRoundedImg(g.cover, x + pad, y + (cardH-coverH)/2, coverW, coverH, 20);

            let tY = y + pad + 45;
            if(textTotalH < coverH) tY += (coverH - textTotalH)/3;

            this.ctx.fillStyle = this.config.colTitle;
            this.ctx.font = `bold 48px ${this.config.fontFamily}`;
            for(let line of titleLines) { this.ctx.fillText(line, textX, tY); tY += 60; }

            tY += 15;
            const s = this.getStatusConfig(g.status);
            this.drawBadge(s.text, textX, tY - 34, s.bg, s.col, 30);

            tY += 80;
            this.ctx.fillStyle = '#a4b0be';
            this.ctx.font = `32px ${this.config.fontFamily}`;
            this.ctx.fillText(g.platform || '全平台', textX, tY);
        }
        return cardH;
    },

    renderGameCardGrid: async function(g, x, y, w, dryRun, fixedHeight) {
        const coverH = w * 1.33; 
        const pad = 36;
        
        this.ctx.font = `bold 42px ${this.config.fontFamily}`;
        const titleLines = this.getWrapLines(g.name, w - pad*2);
        
        const cardH = fixedHeight || (coverH + pad + (titleLines.length * 52) + 20 + 44 + pad);

        if(!dryRun) {
            this.drawCardBase(x, y, w, cardH);
            await this.drawRoundedImg(g.cover, x, y, w, coverH, {tl:36, tr:36, bl:0, br:0}); // 网格上边圆角贴合大卡片

            let tY = y + coverH + pad + 38;
            this.ctx.fillStyle = this.config.colTitle;
            this.ctx.font = `bold 42px ${this.config.fontFamily}`;
            for(let line of titleLines) { this.ctx.fillText(line, x + pad, tY); tY += 52; }

            const s = this.getStatusConfig(g.status);
            this.drawBadge(s.text, x + pad, tY - 20, s.bg, s.col, 28);
        }
        return cardH;
    },

    renderOshiCardSingle: async function(o, x, y, w, dryRun) {
        const pad = 40;
        const size = 180; 
        const textX = x + pad + size + 40;
        const textW = w - (textX - x) - pad;

        this.ctx.font = `bold 52px ${this.config.fontFamily}`;
        const hasTag = o.tags && o.tags.length > 0;
        const textTotalH = 52 + (hasTag ? 30 + 40 : 0);
        
        const cardH = pad + Math.max(size, textTotalH) + pad;

        if(!dryRun) {
            this.drawCardBase(x, y, w, cardH);
            await this.drawCircleImg(o.avatar, x + pad, y + (cardH-size)/2, size);

            let tY = y + pad + 60;
            if(textTotalH < size) tY += (size - textTotalH)/2;

            this.ctx.fillStyle = this.config.colTitle;
            this.ctx.font = `bold 52px ${this.config.fontFamily}`;
            this.ctx.fillText(o.name, textX, tY);

            if(hasTag) {
                tY += 65;
                let tx = textX;
                o.tags.slice(0, 3).forEach(t => {
                    const tagTxt = '#' + t;
                    const tagW = this.ctx.measureText(tagTxt).width;
                    this.drawBadge(tagTxt, tx, tY - 32, '#fff0f5', '#d63384', 28);
                    tx += tagW + 36 + 16;
                });
            }
        }
        return cardH;
    },

    renderOshiCardGrid: async function(o, x, y, w, dryRun, fixedHeight) {
        const pad = 36;
        const size = 200;
        
        this.ctx.font = `bold 42px ${this.config.fontFamily}`;
        const nameLines = this.getWrapLines(o.name, w - pad*2);
        const hasTag = o.tags && o.tags.length > 0;

        const cardH = fixedHeight || (pad + size + 30 + (nameLines.length*52) + (hasTag ? 20 + 40 : 0) + pad);

        if(!dryRun) {
            this.drawCardBase(x, y, w, cardH);
            const cx = x + w/2;
            await this.drawCircleImg(o.avatar, cx - size/2, y + pad, size);

            let tY = y + pad + size + 50;
            this.ctx.textAlign = 'center';
            this.ctx.fillStyle = this.config.colTitle;
            this.ctx.font = `bold 42px ${this.config.fontFamily}`;
            
            for(let line of nameLines) { this.ctx.fillText(line, cx, tY); tY += 52; }

            if(hasTag) {
                tY += 15;
                this.ctx.textAlign = 'left';
                const tagTxt = '#' + o.tags[0];
                this.ctx.font = `26px ${this.config.fontFamily}`;
                const tw = this.ctx.measureText(tagTxt).width + 32;
                this.drawBadge(tagTxt, cx - tw/2, tY - 30, '#fff0f5', '#d63384', 26);
            }
            this.ctx.textAlign = 'left';
        }
        return cardH;
    },

    // --- 绘图引擎工具库 ---

    getWrapLines: function(text, maxWidth) {
        if(!text) return [];
        const chars = text.split('');
        const lines = [];
        let cur = '';
        for (let i = 0; i < chars.length; i++) {
            const test = cur + chars[i];
            if (this.ctx.measureText(test).width > maxWidth && cur.length > 0) {
                lines.push(cur);
                cur = chars[i];
            } else { cur = test; }
        }
        if (cur) lines.push(cur);
        return lines;
    },

    drawCardBase: function(x, y, w, h) {
        this.ctx.save();
        this.ctx.globalAlpha = this.config.cardOpacity;
        // 高级弥散阴影（更柔和）
        this.ctx.shadowColor = 'rgba(0,0,0,0.08)'; 
        this.ctx.shadowBlur = 24;
        this.ctx.shadowOffsetY = 8;
        this.ctx.fillStyle = '#fff';
        this.roundRect(x, y, w, h, 28); // 统一圆角28px
        this.ctx.fill();
        this.ctx.restore();
    },

    drawBadge: function(text, x, y, bg, col, size=28) {
        this.ctx.save();
        this.ctx.font = `${size}px ${this.config.fontFamily}`;
        const w = this.ctx.measureText(text).width + 32; 
        const h = size + 16; 
        this.ctx.fillStyle = bg;
        this.roundRect(x, y, w, h, 12);
        this.ctx.fill();
        this.ctx.fillStyle = col;
        this.ctx.fillText(text, x + 16, y + size + 2);
        this.ctx.restore();
    },

    drawSectionTitle: function(text, y) {
        this.ctx.save();
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = this.config.titleColor;
        this.ctx.font = `bold 42px ${this.config.fontFamily}`;
        this.ctx.letterSpacing = '6px';
        this.ctx.fillText(`— ${text} —`, this.canvas.width/2, y + 40);
        this.ctx.restore();
    },

    drawCoverBg: function(img, h) {
        const w = this.canvas.width;
        const scale = Math.max(w/img.width, h/img.height);
        this.ctx.drawImage(img, (w - img.width*scale)/2, (h - img.height*scale)/2, img.width*scale, img.height*scale);
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
            this.ctx.drawImage(img, x+(w - img.width*scale)/2, y+(h - img.height*scale)/2, img.width*scale, img.height*scale);
        } else {
            this.ctx.fillStyle='#eee'; this.ctx.fillRect(x,y,w,h);
        }
        this.ctx.restore();
    },

    getStatusConfig: (s) => ({
        'wishlist': {text:'想玩', bg:'#fff8e1', col:'#fbc02d'},
        'playing': {text:'在玩', bg:'#e0f2f1', col:'#009688'},
        'finished': {text:'已玩', bg:'#e8f5e9', col:'#4caf50'}
    }[s] || {text:s, bg:'#eee', col:'#666'})
};

window.addEventListener('load', () => {
    app.init();
    Generator.init();
});