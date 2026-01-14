/* -------------------------------------------------------------------------- */
/* DATA STORE                                 */
/* -------------------------------------------------------------------------- */
const Store = {
    get: (key) => JSON.parse(localStorage.getItem(key) || 'null'),
    set: (key, val) => localStorage.setItem(key, JSON.stringify(val)),
    init: () => {
        if (!Store.get('orbit_habits')) Store.set('orbit_habits', []);
        if (!Store.get('orbit_logs')) Store.set('orbit_logs', {});
        if (!Store.get('orbit_settings')) Store.set('orbit_settings', { notifications: false });
    }
};

Store.init();

/* -------------------------------------------------------------------------- */
/* APP LOGIC                                    */
/* -------------------------------------------------------------------------- */
const App = {
    data: {
        habits: Store.get('orbit_habits'),
        logs: Store.get('orbit_logs'),
        settings: Store.get('orbit_settings'),
        currentDate: new Date(),
        viewDate: new Date() // For browsing past/future
    },

    init() {
        this.renderHabits();
        this.updateStats();
        this.setupEventListeners();
        this.checkReminders();
        this.generateWeeklyReview();
        
        // Request notification permission if enabled
        if(this.data.settings.notifications && Notification.permission !== "granted") {
            Notification.requestPermission();
        }

        setInterval(() => this.checkReminders(), 60000); // Check every minute
    },

    save() {
        Store.set('orbit_habits', this.data.habits);
        Store.set('orbit_logs', this.data.logs);
        Store.set('orbit_settings', this.data.settings);
        this.updateStats();
    },

    /* --- DATE UTILS --- */
    getDateStr(date) {
        return date.toISOString().split('T')[0];
    },

    getDayName(date) {
        return date.toLocaleDateString('en-US', { weekday: 'long' });
    },

    /* --- HABIT MANAGEMENT --- */
    addHabit(habit) {
        habit.id = Date.now().toString();
        habit.created = new Date().toISOString();
        habit.streak = 0;
        habit.longestStreak = 0;
        habit.archived = false;
        this.data.habits.push(habit);
        this.save();
        this.renderHabits();
    },

    deleteHabit(id) {
        if(confirm("Delete this habit and all history?")) {
            this.data.habits = this.data.habits.filter(h => h.id !== id);
            // Clean logs
            Object.keys(this.data.logs).forEach(date => {
                delete this.data.logs[date][id];
            });
            this.save();
            this.renderHabits();
        }
    },

    toggleCompletion(id, dateStr) {
        if (!this.data.logs[dateStr]) this.data.logs[dateStr] = {};
        
        const current = this.data.logs[dateStr][id];
        if (current === true) {
            delete this.data.logs[dateStr][id]; // Uncheck
        } else {
            this.data.logs[dateStr][id] = true; // Check
        }
        
        this.recalcStreaks();
        this.save();
        this.renderHabits();
        this.renderDashboardStats();
    },

    recalcStreaks() {
        this.data.habits.forEach(habit => {
            let currentStreak = 0;
            let maxStreak = habit.longestStreak || 0;
            let tempDate = new Date();
            // Start from yesterday to calculate "current" streak correctly or today if done today
            let dStr = this.getDateStr(tempDate);
            
            // If done today, start counting. If not, check yesterday.
            if(this.data.logs[dStr] && this.data.logs[dStr][habit.id]) {
                currentStreak++;
            }
            
            // Loop backwards
            for(let i=1; i<365; i++) {
                tempDate.setDate(tempDate.getDate() - 1);
                let pStr = this.getDateStr(tempDate);
                
                // Check if habit was scheduled for this day
                const dayOfWeek = tempDate.getDay(); // 0 Sun - 6 Sat
                const isScheduled = habit.freqType === 'daily' || habit.days.includes(dayOfWeek);

                if(!isScheduled) continue; // Skip days not scheduled

                if (this.data.logs[pStr] && this.data.logs[pStr][habit.id]) {
                    currentStreak++;
                } else {
                    // Break streak if missed on a scheduled day
                    // Exception: If checking "currentStreak" and we haven't done today's yet, don't break immediately?
                    // Simplified logic: strict streak.
                    break;
                }
            }

            if(currentStreak > maxStreak) maxStreak = currentStreak;
            habit.streak = currentStreak;
            habit.longestStreak = maxStreak;
        });
    },

    /* --- WEEKLY REVIEW (Auto-Generated) --- */
    generateWeeklyReview() {
        const today = new Date();
        const lastReview = Store.get('orbit_last_review_date');
        const diffTime = Math.abs(today - new Date(lastReview || 0));
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

        if (diffDays < 7 && lastReview) return; // Only run once a week or on first load

        // Calculate stats for last 7 days
        let completed = 0;
        let total = 0;
        let bestHabit = { name: 'None', count: -1 };
        let worstHabit = { name: 'None', count: 999 };

        this.data.habits.forEach(h => {
            let hCount = 0;
            for(let i=0; i<7; i++) {
                let d = new Date();
                d.setDate(d.getDate() - i);
                let dStr = this.getDateStr(d);
                if(this.data.logs[dStr] && this.data.logs[dStr][h.id]) hCount++;
                
                // Check schedule
                const day = d.getDay();
                if(h.freqType === 'daily' || h.days.includes(day)) total++;
            }
            completed += hCount;

            if(hCount > bestHabit.count) bestHabit = { name: h.name, count: hCount };
            if(hCount < worstHabit.count) worstHabit = { name: h.name, count: hCount };
        });

        const rate = total === 0 ? 0 : Math.round((completed / total) * 100);
        
        let msg = `You completed <b>${rate}%</b> of your habits this week. `;
        if(rate > 80) msg += "Incredible focus! Keep this momentum. ";
        else if(rate > 50) msg += "Solid effort. Let's aim higher next week. ";
        else msg += "A fresh start begins now. ";

        msg += `<br>🌟 Star Habit: <b>${bestHabit.name}</b>`;
        if(rate < 100) msg += `<br>🔧 Focus On: <b>${worstHabit.name}</b>`;

        const reviewContainer = document.getElementById('weekly-review-container');
        const reviewContent = document.getElementById('weekly-review-content');
        reviewContent.innerHTML = msg;
        reviewContainer.style.display = 'block';

        Store.set('orbit_last_review_date', today);
    },

    /* --- RENDERING --- */
    renderHabits() {
        const list = document.getElementById('habit-list');
        const manageList = document.getElementById('manage-list');
        list.innerHTML = '';
        manageList.innerHTML = '';

        const viewDateStr = this.getDateStr(this.data.viewDate);
        const dayOfWeek = this.data.viewDate.getDay();

        this.data.habits.forEach(habit => {
            // 1. Dashboard List (Only show if scheduled for today/viewDate)
            const isScheduled = habit.freqType === 'daily' || habit.days.includes(dayOfWeek);
            
            if (isScheduled) {
                const isDone = this.data.logs[viewDateStr] && this.data.logs[viewDateStr][habit.id];
                const item = document.createElement('div');
                item.className = `habit-item ${isDone ? 'completed' : ''}`;
                item.innerHTML = `
                    <div class="habit-info">
                        <h4>${habit.name}</h4>
                        <small>🔥 Streak: ${habit.streak}</small>
                    </div>
                    <button class="check-btn" onclick="App.toggleCompletion('${habit.id}', '${viewDateStr}')">
                        <i class="fa-solid fa-check"></i>
                    </button>
                `;
                list.appendChild(item);
            }

            // 2. Manage List (Show All)
            const mItem = document.createElement('div');
            mItem.className = 'habit-item';
            mItem.innerHTML = `
                 <div class="habit-info">
                    <h4>${habit.name}</h4>
                    <small>${habit.freqType === 'daily' ? 'Daily' : 'Specific Days'}</small>
                </div>
                <div>
                    <button class="btn-text" style="color:var(--accent-red)" onclick="App.deleteHabit('${habit.id}')"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
            manageList.appendChild(mItem);
        });

        if(list.innerHTML === '') list.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--text-muted)">No habits scheduled for this day.</div>`;
    },

    renderDashboardStats() {
        const todayStr = this.getDateStr(new Date());
        let scheduled = 0;
        let completed = 0;
        let activeHabits = this.data.habits.length;
        let maxStreak = 0;

        const dayOfWeek = new Date().getDay();

        this.data.habits.forEach(h => {
            if(h.freqType === 'daily' || h.days.includes(dayOfWeek)) {
                scheduled++;
                if(this.data.logs[todayStr] && this.data.logs[todayStr][h.id]) completed++;
            }
            if(h.streak > maxStreak) maxStreak = h.streak;
        });

        const percent = scheduled === 0 ? 0 : Math.round((completed / scheduled) * 100);

        document.getElementById('dash-today-progress').innerText = `${percent}%`;
        document.getElementById('dash-streak').innerText = `${maxStreak} days`;
        document.getElementById('dash-active-count').innerText = activeHabits;
    },

    updateStats() {
        this.renderDashboardStats();
        // Charts are expensive, render only if view is active or on demand
    },

    /* --- NOTIFICATIONS --- */
    checkReminders() {
        if (!this.data.settings.notifications) return;
        const now = new Date();
        const timeStr = now.toTimeString().substr(0, 5); // "14:30"
        const day = now.getDay();
        const dateStr = this.getDateStr(now);

        this.data.habits.forEach(h => {
            // Is it scheduled today?
            if (h.freqType !== 'daily' && !h.days.includes(day)) return;
            
            // Is it completed?
            if (this.data.logs[dateStr] && this.data.logs[dateStr][h.id]) return;

            // Does time match?
            if (h.reminderTime === timeStr) {
                this.sendNotification(`Reminder: ${h.name}`, "Don't break your streak!");
            }
        });
    },

    sendNotification(title, body) {
        if (Notification.permission === "granted") {
            new Notification(title, { body: body, icon: 'icon-192.png' });
        }
    },

    /* --- UI HANDLERS --- */
    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                
                const target = btn.getAttribute('data-target');
                document.getElementById(target).classList.add('active');
                btn.classList.add('active');

                if(target === 'view-analytics') this.renderAnalytics();
                if(target === 'view-calendar') this.renderCalendar();
            });
        });

        // Date Nav
        document.getElementById('prevDay').addEventListener('click', () => {
            this.data.viewDate.setDate(this.data.viewDate.getDate() - 1);
            this.updateDateDisplay();
            this.renderHabits();
        });
        document.getElementById('nextDay').addEventListener('click', () => {
            this.data.viewDate.setDate(this.data.viewDate.getDate() + 1);
            this.updateDateDisplay();
            this.renderHabits();
        });

        // Add Habit Modal
        const modal = document.getElementById('habitModal');
        document.getElementById('btn-add-habit').addEventListener('click', () => {
            document.getElementById('habitForm').reset();
            document.querySelectorAll('.week-select span').forEach(s => s.classList.remove('selected'));
            modal.style.display = 'flex';
        });
        document.getElementById('closeModal').addEventListener('click', () => modal.style.display = 'none');

        // Form Submit
        document.getElementById('habitForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('habitName').value;
            const cat = document.getElementById('habitCategory').value;
            const freq = document.getElementById('habitFreqType').value;
            const time = document.getElementById('habitTime').value;
            
            let days = [];
            if(freq === 'specific') {
                document.querySelectorAll('.week-select span.selected').forEach(el => {
                    days.push(parseInt(el.getAttribute('data-day')));
                });
            } else {
                days = [0,1,2,3,4,5,6];
            }

            this.addHabit({ name, category: cat, freqType: freq, days, reminderTime: time });
            modal.style.display = 'none';
        });

        // Week Selector
        document.getElementById('habitFreqType').addEventListener('change', (e) => {
            document.getElementById('daySelector').style.display = e.target.value === 'specific' ? 'block' : 'none';
        });
        document.querySelectorAll('.week-select span').forEach(sp => {
            sp.addEventListener('click', () => sp.classList.toggle('selected'));
        });

        // Settings
        const toggle = document.getElementById('toggle-notifs');
        toggle.checked = this.data.settings.notifications;
        toggle.addEventListener('change', (e) => {
            this.data.settings.notifications = e.target.checked;
            if(e.target.checked) Notification.requestPermission();
            this.save();
        });

        // Export
        document.getElementById('btn-export').addEventListener('click', () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(Store.get('orbit_habits')));
            const anchor = document.createElement('a');
            anchor.setAttribute("href", dataStr);
            anchor.setAttribute("download", "orbit_backup.json");
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
        });
        
        // Reset
        document.getElementById('btn-reset-data').addEventListener('click', () => {
             if(confirm("DANGER: WIPE ALL DATA?")) {
                 localStorage.clear();
                 location.reload();
             }
        });
    },

    updateDateDisplay() {
        const todayStr = this.getDateStr(new Date());
        const viewStr = this.getDateStr(this.data.viewDate);
        const display = document.getElementById('trackerDate');
        
        if(viewStr === todayStr) display.innerText = 'Today';
        else display.innerText = this.data.viewDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },

    /* --- ANALYTICS --- */
    renderAnalytics() {
        const ctx = document.getElementById('weeklyChart').getContext('2d');
        
        // Calculate last 7 days completion
        const labels = [];
        const dataPoints = [];
        
        for(let i=6; i>=0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            labels.push(d.toLocaleDateString('en-US', {weekday:'short'}));
            
            const dStr = this.getDateStr(d);
            let done = 0;
            // Simplified: Total done checks
            Object.values(this.data.logs[dStr] || {}).forEach(v => { if(v) done++ });
            dataPoints.push(done);
        }

        if(window.myChart) window.myChart.destroy();
        
        window.myChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Habits Completed',
                    data: dataPoints,
                    backgroundColor: '#00d4ff',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: true, grid: { color: '#3a3a45' } },
                    x: { grid: { display: false } }
                },
                plugins: { legend: { display: false } }
            }
        });

        // Best/Worst Calculation
        let habits = this.data.habits.map(h => ({ name: h.name, score: h.streak }));
        habits.sort((a,b) => b.score - a.score);
        
        if(habits.length > 0) {
            document.getElementById('best-habit-name').innerText = `${habits[0].name} (${habits[0].score}d)`;
            document.getElementById('worst-habit-name').innerText = habits[habits.length-1].name;
        }
    },
    
    /* --- CALENDAR --- */
    renderCalendar() {
        const grid = document.getElementById('calendar-grid');
        grid.innerHTML = '';
        const now = new Date(); // Ideally use a state for calendar browsing
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const startDay = monthStart.getDay(); // 0-6

        document.getElementById('cal-month-year').innerText = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        // Empty slots
        for(let i=0; i<startDay; i++) {
            const div = document.createElement('div');
            div.className = 'cal-day empty';
            grid.appendChild(div);
        }

        // Days
        for(let i=1; i<=daysInMonth; i++) {
            const d = new Date(now.getFullYear(), now.getMonth(), i);
            const dStr = this.getDateStr(d);
            const div = document.createElement('div');
            div.className = 'cal-day';
            div.innerText = i;
            
            // Check overall status
            // If any habit completed: green tint. If all target missed: red tint.
            // Simplified for view: Darker green for more habits done
            let count = 0;
            if (this.data.logs[dStr]) {
                count = Object.keys(this.data.logs[dStr]).length;
            }

            if(count > 0) {
                div.classList.add('completed');
                div.style.backgroundColor = `rgba(0, 212, 255, ${Math.min(count * 0.2, 0.8)})`;
            }
            
            grid.appendChild(div);
        }
    }
};

// Start
document.addEventListener('DOMContentLoaded', () => App.init());