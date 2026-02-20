/**
 * ST-AutoPulse Lite - 纯前端版本
 * 不需要 Server Plugin，所有定时器在浏览器中运行。
 * 关闭页面后定时器会停止。
 */

const MODULE_NAME = 'ST-AutoPulse-Lite';
const PLUGIN_ID = 'autopulse-lite';

// ─── Default Settings ────────────────────────────────────────────────

const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    intervalMinutes: 30,
    prompt: '',
    notifyDesktop: true,
});

const DEFAULT_PROMPT = '一段时间过去了。请根据当前的对话上下文、角色性格和背景设定，以角色的身份主动向用户发送一条自然的消息。这条消息应该像是角色在想到用户时自然地发出的，可以是问候、分享日常、表达关心、或延续之前的话题。请保持角色的语气和风格一致。';

// ─── State ───────────────────────────────────────────────────────────

let isGenerating = false;
let nextTriggerTime = null;
let countdownInterval = null;
let autoTimerInterval = null;

// ─── Helpers ─────────────────────────────────────────────────────────

function getSettings() {
    const ctx = SillyTavern.getContext();
    if (!ctx.extensionSettings[MODULE_NAME]) {
        ctx.extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    const settings = ctx.extensionSettings[MODULE_NAME];
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = DEFAULT_SETTINGS[key];
        }
    }
    return settings;
}

function saveSettings() {
    const ctx = SillyTavern.getContext();
    ctx.saveSettingsDebounced();
}

// ─── Timer Management ────────────────────────────────────────────────

function startTimer() {
    stopTimer();

    const settings = getSettings();
    if (!settings.enabled) return;

    const intervalMs = settings.intervalMinutes * 60 * 1000;

    autoTimerInterval = setInterval(() => {
        console.log('[AutoPulse Lite] Timer fired!');
        handleTrigger(settings.prompt, `定时消息 (每${settings.intervalMinutes}分钟)`);
    }, intervalMs);

    nextTriggerTime = Date.now() + intervalMs;
    startCountdown();

    console.log(`[AutoPulse Lite] Timer started, interval: ${settings.intervalMinutes} min`);
}

function stopTimer() {
    if (autoTimerInterval) {
        clearInterval(autoTimerInterval);
        autoTimerInterval = null;
    }
    nextTriggerTime = null;
    stopCountdown();
}

function resetTimer() {
    const settings = getSettings();
    if (settings.enabled) {
        startTimer();
    }
}

// ─── Message Generation ──────────────────────────────────────────────

/**
 * Handle a trigger event: generate a message from the character.
 * @param {string} customPrompt Custom prompt override
 * @param {string} source Description of what triggered this
 */
async function handleTrigger(customPrompt, source = '自动消息') {
    if (isGenerating) {
        console.log('[AutoPulse Lite] Already generating, skipping trigger');
        return;
    }

    const ctx = SillyTavern.getContext();

    // Check if there's an active chat
    if (!ctx.characterId && !ctx.groupId) {
        console.log('[AutoPulse Lite] No active chat, skipping trigger');
        return;
    }

    // Check if chat exists
    if (!ctx.chat || ctx.chat.length === 0) {
        console.log('[AutoPulse Lite] Empty chat, skipping trigger');
        return;
    }

    const settings = getSettings();
    const prompt = customPrompt || settings.prompt || DEFAULT_PROMPT;

    isGenerating = true;
    console.log(`[AutoPulse Lite] Generating message (source: ${source})...`);

    try {
        // Use generateQuietPrompt to generate text with chat context
        const result = await ctx.generateQuietPrompt({
            quietPrompt: prompt,
            quietImage: null,
            skipWIAN: false,
        });

        if (!result || result.trim().length === 0) {
            console.warn('[AutoPulse Lite] Generated empty response, skipping');
            return;
        }

        // Build the message object
        const messageText = result.trim();
        const message = {
            name: ctx.name2, // Character name
            is_user: false,
            mes: messageText,
            force_avatar: ctx.getThumbnailUrl('avatar', ctx.characters[ctx.characterId]?.avatar),
            extra: {
                autopulse: true,
                autopulse_source: source,
                autopulse_timestamp: Date.now(),
            },
        };

        // Add the message to the chat
        ctx.chat.push(message);
        const messageId = ctx.chat.length - 1;
        ctx.addOneMessage(message, { insertAfter: messageId - 1 });

        // Save the chat
        await ctx.saveChat();

        console.log(`[AutoPulse Lite] Message generated and added to chat: "${messageText.substring(0, 50)}..."`);

        // Show toast notification
        toastr.info(`${ctx.name2} 主动发了消息`, 'AutoPulse Lite', { timeOut: 3000 });

        // Desktop notification
        if (settings.notifyDesktop) {
            sendDesktopNotification(ctx.name2, messageText);
        }

        // Reset the timer countdown
        resetTimer();

    } catch (e) {
        console.error('[AutoPulse Lite] Failed to generate message:', e);
        toastr.error(`消息生成失败: ${e.message}`, 'AutoPulse Lite');
    } finally {
        isGenerating = false;
    }
}

// ─── Desktop Notifications ───────────────────────────────────────────

function sendDesktopNotification(characterName, message) {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'granted') {
        new Notification(`${characterName} 发来了消息`, {
            body: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
            icon: '/favicon.ico',
            tag: 'autopulse-lite',
        });
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(perm => {
            if (perm === 'granted') {
                sendDesktopNotification(characterName, message);
            }
        });
    }
}

// ─── Countdown Display ──────────────────────────────────────────────

function startCountdown() {
    stopCountdown();
    updateCountdownDisplay();
    countdownInterval = setInterval(updateCountdownDisplay, 1000);
    $('#autopulse_timer_info').show();
}

function stopCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    $('#autopulse_timer_info').hide();
}

function updateCountdownDisplay() {
    if (!nextTriggerTime) {
        $('#autopulse_next_trigger').text('已停止');
        return;
    }

    const remaining = nextTriggerTime - Date.now();
    if (remaining <= 0) {
        $('#autopulse_next_trigger').text('即将触发...');
        return;
    }

    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    $('#autopulse_next_trigger').text(
        `下次触发：${minutes}分${String(seconds).padStart(2, '0')}秒`
    );
}

// ─── UI Status ───────────────────────────────────────────────────────

function updateStatusUI() {
    const dot = $('#autopulse_status_dot');
    const text = $('#autopulse_status_text');
    const settings = getSettings();

    dot.removeClass('connected disconnected active');

    if (settings.enabled) {
        dot.addClass('active');
        text.text('前端定时器运行中（关闭页面后停止）');
    } else {
        dot.addClass('disconnected');
        text.text('已停用');
    }
}

// ─── UI Event Handlers ──────────────────────────────────────────────

function onEnabledChange() {
    const settings = getSettings();
    settings.enabled = $('#autopulse_enabled').prop('checked');
    saveSettings();
    if (settings.enabled) {
        startTimer();
    } else {
        stopTimer();
    }
    updateStatusUI();
}

function onIntervalChange(value) {
    const settings = getSettings();
    const v = Math.max(1, Math.min(180, Number(value) || 30));
    settings.intervalMinutes = v;
    $('#autopulse_interval_range').val(v);
    $('#autopulse_interval_input').val(v);
    saveSettings();
    if (settings.enabled) {
        startTimer();
    }
}

function onPromptChange() {
    const settings = getSettings();
    settings.prompt = $('#autopulse_prompt').val().trim();
    saveSettings();
}

function onNotifyChange() {
    const settings = getSettings();
    settings.notifyDesktop = $('#autopulse_notify').prop('checked');
    saveSettings();

    // Request notification permission if enabling
    if (settings.notifyDesktop && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function onTriggerNow() {
    const settings = getSettings();
    handleTrigger(settings.prompt, '手动触发');
}

// ─── Slash Commands ──────────────────────────────────────────────────

function registerSlashCommands() {
    const ctx = SillyTavern.getContext();

    ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
        name: 'autopulse',
        callback: async (namedArgs, unnamedArgs) => {
            const subcommand = String(unnamedArgs || '').trim().toLowerCase();
            const settings = getSettings();

            switch (subcommand) {
                case 'on':
                    settings.enabled = true;
                    $('#autopulse_enabled').prop('checked', true);
                    saveSettings();
                    startTimer();
                    updateStatusUI();
                    return '✅ AutoPulse Lite 已启用';

                case 'off':
                    settings.enabled = false;
                    $('#autopulse_enabled').prop('checked', false);
                    saveSettings();
                    stopTimer();
                    updateStatusUI();
                    return '⏹ AutoPulse Lite 已禁用';

                case 'trigger':
                    await handleTrigger(settings.prompt, 'Slash 命令触发');
                    return '⚡ 已触发角色消息生成';

                case 'status':
                    return `📊 AutoPulse Lite 状态:\n` +
                        `- 启用: ${settings.enabled ? '是' : '否'}\n` +
                        `- 间隔: ${settings.intervalMinutes} 分钟\n` +
                        `- 模式: 纯前端（关闭页面后停止）\n` +
                        `- 定时器: ${autoTimerInterval ? '运行中' : '已停止'}`;

                default: {
                    // Check if it's an interval setting: /autopulse 30
                    const num = parseInt(subcommand);
                    if (!isNaN(num) && num >= 1 && num <= 180) {
                        settings.intervalMinutes = num;
                        onIntervalChange(num);
                        return `⏱ 间隔已设置为 ${num} 分钟`;
                    }
                    return '用法: /autopulse [on|off|trigger|status|<分钟数>]';
                }
            }
        },
        helpString: `
            <div>
                控制 AutoPulse Lite 自动消息功能（纯前端版本）。
            </div>
            <div>
                <strong>用法：</strong>
                <ul>
                    <li><code>/autopulse on</code> — 启用自动消息</li>
                    <li><code>/autopulse off</code> — 禁用自动消息</li>
                    <li><code>/autopulse trigger</code> — 立即触发一次</li>
                    <li><code>/autopulse status</code> — 查看状态</li>
                    <li><code>/autopulse 30</code> — 设置间隔为30分钟</li>
                </ul>
            </div>
        `,
        unnamedArgumentList: [
            ctx.SlashCommandArgument.fromProps({
                description: 'on/off/trigger/status 或分钟数',
                typeList: [ctx.ARGUMENT_TYPE.STRING],
                isRequired: false,
                enumList: ['on', 'off', 'trigger', 'status'],
            }),
        ],
    }));

    console.log('[AutoPulse Lite] Slash commands registered');
}

// ─── Initialization ─────────────────────────────────────────────────

function loadSettingsUI() {
    const settings = getSettings();

    $('#autopulse_enabled').prop('checked', settings.enabled);
    $('#autopulse_interval_range').val(settings.intervalMinutes);
    $('#autopulse_interval_input').val(settings.intervalMinutes);
    $('#autopulse_prompt').val(settings.prompt);
    $('#autopulse_notify').prop('checked', settings.notifyDesktop);
}

async function initExtension() {
    const ctx = SillyTavern.getContext();

    // Load HTML template
    const settingsHtml = await $.get(`scripts/extensions/third-party/${MODULE_NAME}/settings.html`);
    $('#extensions_settings').append(settingsHtml);

    // Bind UI events
    $('#autopulse_enabled').on('change', onEnabledChange);
    $('#autopulse_interval_range').on('input', function () { onIntervalChange(this.value); });
    $('#autopulse_interval_input').on('change', function () { onIntervalChange(this.value); });
    $('#autopulse_prompt').on('change', onPromptChange);
    $('#autopulse_notify').on('change', onNotifyChange);
    $('#autopulse_trigger_now').on('click', onTriggerNow);

    // Load settings into UI
    loadSettingsUI();
    updateStatusUI();

    // Register slash commands
    registerSlashCommands();

    // Start timer if enabled
    const settings = getSettings();
    if (settings.enabled) {
        startTimer();
    }

    // Listen for user messages to reset the idle timer
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_SENT, () => {
        const settings = getSettings();
        if (settings.enabled) {
            resetTimer();
        }
    });

    // Listen for chat changes
    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => {
        if (getSettings().enabled) {
            resetTimer();
        }
    });

    console.log('[AutoPulse Lite] UI Extension initialized! (frontend-only mode)');
}

// ─── Entry Point ─────────────────────────────────────────────────────

jQuery(async () => {
    const ctx = SillyTavern.getContext();

    // Wait for app to be ready
    ctx.eventSource.on(ctx.eventTypes.APP_READY, async () => {
        await initExtension();
    });
});
