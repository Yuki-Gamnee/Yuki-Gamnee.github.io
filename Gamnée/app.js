// --- 配置与数据库 ---
const DB_NAME = 'GamneeDB_v7'; 
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
// [推し長図] 生成器 (2025.02.14 终版·胶囊放大+间距优化)
// ==========================================
const Generator = {
    canvas: null,
    ctx: null,
    bgImage: null,
    config: {
        showProfile: true,
        showPlaying: true,
        showFinished: true,
        showWishlist: false,
        showOshi: true,
        bgColor: '#faf9fe',
        bgImage: null,
        cardOpacity: 1.0,
        columns: 1,
        fontFamily: 'sans-serif',
        width: 750,
        padding: 40,
        cardRadius: 20
    },
    
    init: function() {
        this.canvas = document.getElementById('gen-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.bindEvents();
        this.loadConfig();
    },

    loadConfig: function() {
        const saved = localStorage.getItem('gamnee_generator_config');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                Object.assign(this.config, parsed);
                this.syncUIConfig();
            } catch(e) {}
        }
    },

    saveConfig: function() {
        localStorage.setItem('gamnee_generator_config', JSON.stringify(this.config));
    },

    syncUIConfig: function() {
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

        const opacitySlider = document.getElementById('gen-card-opacity');
        if(opacitySlider) opacitySlider.value = this.config.cardOpacity;

        const colBtns = document.querySelectorAll('.toggle-btn[data-col]');
        colBtns.forEach(btn => btn.classList.remove('active'));
        const activeColBtn = Array.from(colBtns).find(btn => parseInt(btn.dataset.col) === this.config.columns);
        if(activeColBtn) activeColBtn.classList.add('active');

        const fontBtns = document.querySelectorAll('#font-family-toggle .toggle-btn');
        fontBtns.forEach(btn => btn.classList.remove('active'));
        const activeFontBtn = Array.from(fontBtns).find(btn => btn.dataset.font === this.config.fontFamily);
        if(activeFontBtn) activeFontBtn.classList.add('active');
        else fontBtns[0]?.classList.add('active');

        const resetBgBtn = document.getElementById('btn-gen-reset-bg');
        if(resetBgBtn) resetBgBtn.style.display = this.config.bgImage ? 'block' : 'none';
    },

    bindEvents: function() {
        const btn = document.getElementById('fab-generator');
        if(btn) btn.onclick = () => {
            document.getElementById('sheet-generator').classList.add('active');
            this.loadConfig(); 
            this.draw();
        };

        ['profile','playing','finished','wishlist','oshi'].forEach(k => {
            const el = document.getElementById('gen-check-' + k);
            if(el) el.onchange = (e) => { 
                this.config['show' + k.charAt(0).toUpperCase() + k.slice(1)] = e.target.checked; 
                this.saveConfig();
                this.draw(); 
            };
        });

        const colBtns = document.querySelectorAll('.toggle-btn[data-col]');
        colBtns.forEach(b => b.onclick = (e) => {
            colBtns.forEach(x => x.classList.remove('active'));
            e.target.classList.add('active');
            this.config.columns = parseInt(e.target.dataset.col);
            this.saveConfig();
            this.draw();
        });

        const exportBtn = document.getElementById('btn-export-image');
        if(exportBtn) exportBtn.onclick = () => {
            const link = document.createElement('a');
            link.download = `Gamnee_${Date.now()}.png`;
            link.href = this.canvas.toDataURL('image/png');
            link.click();
        };

        // 背景图片上传
        const bgUploadBtn = document.getElementById('btn-gen-bg-img');
        const bgInput = document.getElementById('gen-bg-input');
        const resetBgBtn = document.getElementById('btn-gen-reset-bg');

        if (bgUploadBtn) {
            bgUploadBtn.addEventListener('click', () => bgInput.click());
        }
        if (bgInput) {
            bgInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const img = new Image();
                    img.onload = () => {
                        this.config.bgImage = img;
                        this.config.bgColor = null;
                        this.saveConfig();
                        if (resetBgBtn) resetBgBtn.style.display = 'block';
                        this.draw();
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(file);
            });
        }
        if (resetBgBtn) {
            resetBgBtn.addEventListener('click', () => {
                this.config.bgImage = null;
                this.config.bgColor = '#faf9fe';
                this.saveConfig();
                resetBgBtn.style.display = 'none';
                const colorPicker = document.getElementById('gen-bg-color');
                if (colorPicker) colorPicker.value = '#faf9fe';
                this.draw();
            });
        }

        const bgColorPicker = document.getElementById('gen-bg-color');
        if (bgColorPicker) {
            bgColorPicker.addEventListener('input', (e) => {
                this.config.bgColor = e.target.value;
                this.config.bgImage = null;
                this.saveConfig();
                if (resetBgBtn) resetBgBtn.style.display = 'none';
                this.draw();
            });
        }

        const opacitySlider = document.getElementById('gen-card-opacity');
        if (opacitySlider) {
            opacitySlider.addEventListener('input', (e) => {
                this.config.cardOpacity = parseFloat(e.target.value);
                this.saveConfig();
                this.draw();
            });
        }

        const fontBtns = document.querySelectorAll('#font-family-toggle .toggle-btn');
        fontBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                fontBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.config.fontFamily = e.target.dataset.font;
                this.saveConfig();
                this.draw();
            });
        });
    },

    getFontString: function(weight, size) {
        return `${weight || 'normal'} ${size}px ${this.config.fontFamily || 'sans-serif'}`;
    },

    // --- 核心绘制逻辑（2025.02.14 终版）---
    draw: async function() {
        const user = {
            name: localStorage.getItem('gamnee_username') || 'Gamnée 玩家',
            bio: localStorage.getItem('gamnee_bio') || '暂无简介',
            avatar: localStorage.getItem('gamnee_avatar') || ''
        };

        const games = (app.data.games || []).filter(g => {
            if (g.status === 'playing' && this.config.showPlaying) return true;
            if (g.status === 'finished' && this.config.showFinished) return true;
            if (g.status === 'wishlist' && this.config.showWishlist) return true;
            return false;
        });

        const oshis = this.config.showOshi ? (app.data.oshi || []) : [];

        // 布局常量（终版优化）
        const ONE_COL = this.config.columns === 1;
        const CARD_H = ONE_COL ? 200 : 300;          // 双列高度增加到300，容纳更大胶囊和间距
        const OSHI_H = ONE_COL ? 180 : 200;
        const CARD_GAP = 30;
        const SECTION_GAP = 60;
        const TITLE_H = 70;

        // 计算总高度
        let totalH = 100;
        if (this.config.showProfile) {
            totalH += 200 + SECTION_GAP;
        }
        
        if (games.length > 0) {
            totalH += TITLE_H;
            const rows = Math.ceil(games.length / this.config.columns);
            totalH += rows * CARD_H + (rows - 1) * CARD_GAP + SECTION_GAP;
        }

        if (oshis.length > 0) {
            totalH += TITLE_H;
            const rows = Math.ceil(oshis.length / this.config.columns);
            totalH += rows * OSHI_H + (rows - 1) * CARD_GAP + SECTION_GAP;
        }

        totalH += 100;

        this.canvas.width = this.config.width;
        this.canvas.height = totalH;
        this.canvas.style.width = '100%';
        this.canvas.style.height = 'auto';

        // 绘制背景
        if (this.config.bgImage) {
            const img = this.config.bgImage;
            const scale = Math.max(this.canvas.width / img.width, this.canvas.height / img.height);
            const x = (this.canvas.width - img.width * scale) / 2;
            const y = (this.canvas.height - img.height * scale) / 2;
            this.ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
        } else {
            this.ctx.fillStyle = this.config.bgColor || '#faf9fe';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        let curY = 80;

        // 个人资料卡片
        if (this.config.showProfile) {
            await this.drawProfileCard(user, curY);
            curY += 200 + SECTION_GAP;
        }

        // 游戏列表
        if (games.length > 0) {
            this.drawSectionTitle('GAME RECORDS', curY);
            curY += TITLE_H;
            
            const colW = (this.canvas.width - this.config.padding*2 - (ONE_COL ? 0 : 30)) / this.config.columns;

            for (let i = 0; i < games.length; i++) {
                const row = Math.floor(i / this.config.columns);
                const col = i % this.config.columns;
                const x = this.config.padding + col * (colW + 30);
                const y = curY + row * (CARD_H + CARD_GAP);
                await this.drawGameCard(games[i], x, y, colW, CARD_H, ONE_COL);
            }
            const rows = Math.ceil(games.length / this.config.columns);
            curY += rows * (CARD_H + CARD_GAP) + SECTION_GAP;
        }

        // 推し角色
        if (oshis.length > 0) {
            this.drawSectionTitle('MY OSHI', curY);
            curY += TITLE_H;
            
            const colW = (this.canvas.width - this.config.padding*2 - (ONE_COL ? 0 : 30)) / this.config.columns;

            for (let i = 0; i < oshis.length; i++) {
                const row = Math.floor(i / this.config.columns);
                const col = i % this.config.columns;
                const x = this.config.padding + col * (colW + 30);
                const y = curY + row * (OSHI_H + CARD_GAP);
                await this.drawOshiCard(oshis[i], x, y, colW, OSHI_H, ONE_COL);
            }
        }

        // Footer
        this.ctx.fillStyle = '#ccc';
        this.ctx.font = this.getFontString('normal', 24);
        this.ctx.textAlign = 'center';
        this.ctx.fillText('Generated with Gamnée', this.canvas.width/2, totalH - 40);
    },

    // --- 个人资料卡片（高度200，紧凑）---
    drawProfileCard: async function(u, y) {
        const x = this.config.padding;
        const w = this.canvas.width - x*2;
        const h = 200;
        
        this.ctx.save();
        if (this.config.cardOpacity !== undefined) {
            this.ctx.globalAlpha = this.config.cardOpacity;
        }
        this.drawShadowRect(x, y, w, h);
        this.ctx.restore();

        await this.drawCircleImg(u.avatar, x + 40, y + 40, 120);
        
        this.ctx.save();
        this.ctx.fillStyle = '#333';
        this.ctx.textAlign = 'left';
        this.ctx.font = this.getFontString('bold', 40);
        this.ctx.fillText(u.name, x + 190, y + 80);
        
        this.ctx.fillStyle = '#777';
        this.ctx.font = this.getFontString('normal', 24);
        this.wrapText(u.bio, x + 190, y + 125, w - 220, 32);
        this.ctx.restore();
    },

    // --- 游戏卡片（终版优化：间距加大、胶囊放大）---
    drawGameCard: async function(g, x, y, w, h, isSingle) {
        // 卡片背景透明度
        this.ctx.save();
        if (this.config.cardOpacity !== undefined) {
            this.ctx.globalAlpha = this.config.cardOpacity;
        }
        this.drawShadowRect(x, y, w, h);
        this.ctx.restore();

        this.ctx.save();

        if (isSingle) {
            // 单列布局：胶囊放大（字体22px）
            await this.drawRoundedImg(g.cover, x + 30, y + (h - 150)/2, 110, 150, 12);
            const textX = x + 160;
            this.ctx.fillStyle = '#333';
            this.ctx.font = this.getFontString('bold', 30);
            this.ctx.fillText(g.name, textX, y + 60);
            const statusColor = g.status === 'playing' ? '#009688' : (g.status === 'finished' ? '#666' : '#FF9800');
            const statusBg = g.status === 'playing' ? '#E0F2F1' : (g.status === 'finished' ? '#F5F5F5' : '#FFF3E0');
            this.drawBadge(app.getStatusText(g.status), textX, y + 90, statusBg, statusColor, 22); // 字体22px
            this.ctx.fillStyle = '#999';
            this.ctx.font = this.getFontString('normal', 20);
            this.ctx.fillText(g.platform || '全平台', textX, y + 145);
        } else {
            // ===== 双列布局（终版优化）=====
            // 1. 图片：边距16px，圆角20px
            const imgSize = w - 32;
            const imgX = x + 16;
            const imgY = y + 16;
            await this.drawRoundedImg(g.cover, imgX, imgY, imgSize, imgSize, 20);

            // 2. 游戏名称：与图片间距增加 40→50
            this.ctx.fillStyle = '#333';
            this.ctx.font = this.getFontString('500', 24);
            this.ctx.textAlign = 'left';
            let title = g.name;
            const maxTitleWidth = w - 32;
            if (this.ctx.measureText(title).width > maxTitleWidth) {
                for (let i = title.length; i > 0; i--) {
                    const sub = title.substring(0, i) + '…';
                    if (this.ctx.measureText(sub).width <= maxTitleWidth) {
                        title = sub;
                        break;
                    }
                }
            }
            this.ctx.fillText(title, x + 16, y + imgSize + 50); // 原40 → 50

            // 3. 状态标签：字体18px，胶囊高度30px，圆角15px，留白更大
            const statusText = app.getStatusText(g.status);
            this.ctx.font = this.getFontString('normal', 18);   // 16→18
            const statusWidth = this.ctx.measureText(statusText).width + 20; // 宽度增加
            const statusHeight = 30;                            // 24→30
            const statusY = y + imgSize + 70;                  // 原56+14调整
            this.ctx.fillStyle = g.status === 'playing' ? '#E0F2F1' : (g.status === 'finished' ? '#F5F5F5' : '#FFF3E0');
            this.roundRect(x + 16, statusY, statusWidth, statusHeight, 15); // 圆角12→15
            this.ctx.fill();
            this.ctx.fillStyle = g.status === 'playing' ? '#009688' : (g.status === 'finished' ? '#666' : '#F57C00');
            this.ctx.font = this.getFontString('normal', 18);
            this.ctx.fillText(statusText, x + 16 + 10, statusY + 23); // 垂直居中
        }
        this.ctx.restore();
    },

    // --- 推し卡片（垂直居中布局）---
    drawOshiCard: async function(o, x, y, w, h, isSingle) {
        this.ctx.save();
        if (this.config.cardOpacity !== undefined) {
            this.ctx.globalAlpha = this.config.cardOpacity;
        }
        this.drawShadowRect(x, y, w, h);
        this.ctx.restore();

        this.ctx.save();
        this.ctx.textAlign = 'center';

        if (isSingle) {
            // 单列布局（水平排列）
            await this.drawCircleImg(o.avatar, x + 30, y + (h-80)/2, 80);
            this.ctx.textAlign = 'left';
            this.ctx.fillStyle = '#333';
            this.ctx.font = this.getFontString('bold', 32);
            this.ctx.fillText(o.name, x + 130, y + 60);
            if(o.tags && o.tags.length){
                let tx = x + 130;
                o.tags.slice(0, 2).forEach(t => {
                    this.drawBadge('#'+t, tx, y + 85, '#FFF0F5', '#D63384', 20);
                    tx += this.ctx.measureText('#'+t).width + 20;
                });
            }
        } else {
            // 双列布局（上图下文，完全居中）
            const centerX = x + w/2;
            await this.drawCircleImg(o.avatar, centerX - 40, y + 30, 80);
            
            this.ctx.fillStyle = '#333';
            this.ctx.font = this.getFontString('bold', 22);
            this.ctx.fillText(o.name, centerX, y + 130);
            
            if(o.tags && o.tags.length){
                let tagStr = o.tags.slice(0, 2).map(t => '#'+t).join(' ');
                if (this.ctx.measureText(tagStr).width > w - 20) {
                    tagStr = '#' + o.tags[0];
                }
                this.ctx.font = this.getFontString('normal', 16);
                const tagWidth = this.ctx.measureText(tagStr).width + 20;
                const tagX = centerX - tagWidth/2;
                this.ctx.fillStyle = '#FFF0F5';
                this.roundRect(tagX, y + 145, tagWidth, 26, 13);
                this.ctx.fill();
                this.ctx.fillStyle = '#D63384';
                this.ctx.fillText(tagStr, centerX, y + 164);
            }
        }
        this.ctx.restore();
    },

    // --- 辅助绘图函数（阴影、圆角、文字）---
    drawShadowRect: function(x, y, w, h) {
        this.ctx.save();
        this.ctx.fillStyle = '#fff';
        this.ctx.shadowColor = 'rgba(0,0,0,0.04)';
        this.ctx.shadowBlur = 16;
        this.ctx.shadowOffsetY = 6;
        this.ctx.shadowOffsetX = 0;
        this.roundRect(x, y, w, h, 20);
        this.ctx.fill();
        this.ctx.restore();
    },

    drawBadge: function(text, x, y, bg, color, fontSize = 24) {
        this.ctx.save();
        this.ctx.font = this.getFontString('normal', fontSize);
        const w = this.ctx.measureText(text).width + 16;
        const h = fontSize + 8;
        this.ctx.fillStyle = bg;
        this.roundRect(x, y, w, h, 12);
        this.ctx.fill();
        this.ctx.fillStyle = color;
        this.ctx.font = this.getFontString('normal', fontSize);
        this.ctx.fillText(text, x + 8, y + fontSize + 2);
        this.ctx.restore();
    },

    drawSectionTitle: function(text, y) {
        this.ctx.save();
        this.ctx.fillStyle = '#aaa';
        this.ctx.font = this.getFontString('normal', 28);
        this.ctx.letterSpacing = '2px';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`— ${text} —`, this.canvas.width/2, y + 40);
        this.ctx.restore();
    },

    wrapText: function(text, x, y, maxWidth, lineHeight) {
        const words = text.split('');
        let line = '';
        for(let n = 0; n < words.length; n++) {
            const testLine = line + words[n];
            if (this.ctx.measureText(testLine).width > maxWidth && n > 0) {
                this.ctx.fillText(line, x, y);
                line = words[n];
                y += lineHeight;
            } else {
                line = testLine;
            }
        }
        this.ctx.fillText(line, x, y);
    },

    roundRect: function(x, y, w, h, r) {
        if(typeof r !== 'object') r = {tl:r, tr:r, br:r, bl:r};
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

    loadImage: function(src) {
        return new Promise(r => {
            if(!src) return r(null);
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => r(img);
            img.onerror = () => r(null);
            img.src = src;
        });
    },

    drawCircleImg: async function(src, x, y, size) {
        const img = await this.loadImage(src);
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(x+size/2, y+size/2, size/2, 0, Math.PI*2);
        this.ctx.clip();
        if(img) this.ctx.drawImage(img, x, y, size, size);
        else { this.ctx.fillStyle='#eee'; this.ctx.fillRect(x, y, size, size); }
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
            this.ctx.fillStyle='#eee';
            this.ctx.fillRect(x, y, w, h);
        }
        this.ctx.restore();
    }
};

window.addEventListener('load', () => Generator.init());
window.onload = () => app.init();