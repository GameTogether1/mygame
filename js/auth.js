/**
 * 认证与会员模块（纯静态 JS 版本）
 * 包含：Supabase 初始化、登录/注册（邮箱白名单 + 60s 冷却）、忘记密码、账号中心、修改密码、会员支付验证、Toast 提示
 */

const SUPABASE_URL = 'https://szeedpcuharbupkjrnob.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6ZWVkcGN1aGFyYnVwa2pybm9iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NTY3MDAsImV4cCI6MjA4ODEzMjcwMH0.7Qhchq8-NJG_Yqpx40r2idwt9iN98Hg63cHWIZ8lMTY';

const ALLOWED_EMAIL_DOMAINS = [
    'qq.com', 'sina.com', 'sina.cn', 'gmail.com', '163.com', '126.com',
    'yeah.net', 'foxmail.com', 'outlook.com', 'hotmail.com', 'live.com',
    'yahoo.com', 'yahoo.cn', 'sohu.com', '139.com', 'aliyun.com',
    'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'protonmail.ch'
];

let supabaseClient = null;
try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
    console.error('Supabase 初始化失败:', err);
}

let currentUser = null;
let currentProfile = null;
let prevLoggedIn = null;
let isRegisterMode = false;
let registerCooldown = 0;
let cooldownTimer = null;

// ========== 全局工具：Toast 与弹窗控制 ==========
window.showToast = function (message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const styles = {
        success: 'border-green-500/40 bg-dark-light/95 text-green-300',
        error: 'border-red-500/40 bg-dark-light/95 text-red-300',
        warning: 'border-amber-500/40 bg-dark-light/95 text-amber-300',
        info: 'border-blue-500/40 bg-dark-light/95 text-blue-300'
    };
    const icons = {
        success: 'fa-check-circle text-green-400',
        error: 'fa-times-circle text-red-400',
        warning: 'fa-exclamation-triangle text-amber-400',
        info: 'fa-info-circle text-blue-400'
    };

    const toast = document.createElement('div');
    toast.className = `flex items-center gap-2.5 px-4 py-3 rounded-xl border ${styles[type] || styles.info} backdrop-blur-md shadow-xl text-sm font-medium transition-all duration-300 translate-x-8 opacity-0`;
    toast.innerHTML = `<i class="fa ${icons[type] || icons.info} text-base"></i><span>${message}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.remove('translate-x-8', 'opacity-0');
    });

    setTimeout(() => {
        toast.classList.add('translate-x-8', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 2800);
};

window.openModalById = function (id) {
    document.getElementById(id)?.classList.remove('hidden');
};

window.closeModalById = function (id) {
    document.getElementById(id)?.classList.add('hidden');
};

function shakeElement(el) {
    if (!el) return;
    el.classList.remove('shake-animation');
    void el.offsetWidth;
    el.classList.add('shake-animation');
}

function getTodayCompactDate() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// ========== 导航栏与账号状态更新 ==========
function updateAuthNavUI() {
    const label = document.getElementById('nav-auth-label');
    const popover = document.getElementById('login-guide-popover');
    if (!label) return;

    const isLoggedIn = Boolean(currentUser && currentProfile);
    if (isLoggedIn) {
        label.textContent = currentProfile.is_member ? '⭐ 账号' : '账号';
        if (prevLoggedIn === false && popover) {
            popover.classList.remove('hidden');
            setTimeout(() => popover.classList.add('hidden'), 3000);
        }
    } else {
        label.textContent = '登录';
    }
    prevLoggedIn = isLoggedIn;
}

async function loadUserSession(session) {
    if (!session) {
        currentUser = null;
        currentProfile = null;
        updateAuthNavUI();
        return;
    }

    currentUser = session.user;
    try {
        const { data, error } = await supabaseClient
            .from('GameTogether')
            .select('*')
            .eq('id', session.user.id)
            .single();
        currentProfile = (!error && data) ? data : { id: session.user.id, email: session.user.email, is_member: false };
    } catch {
        currentProfile = { id: session.user.id, email: session.user.email, is_member: false };
    }
    updateAuthNavUI();
}

// ========== 登录 / 注册逻辑 ==========
function syncAuthModalUI() {
    const title = document.getElementById('auth-modal-title');
    const submitBtn = document.getElementById('auth-submit-btn');
    const forgotBtn = document.getElementById('open-forgot-btn');
    const toggleBtn = document.getElementById('toggle-auth-mode-btn');

    if (title) title.textContent = isRegisterMode ? '创建账号' : '账号登录';
    if (forgotBtn) forgotBtn.classList.toggle('hidden', isRegisterMode);
    if (toggleBtn) toggleBtn.textContent = isRegisterMode ? '去登录' : '去注册';
    const pwdInput = document.getElementById('auth-password');
    if (pwdInput) pwdInput.setAttribute('autocomplete', isRegisterMode ? 'new-password' : 'current-password');
    if (submitBtn) {
        if (isRegisterMode && registerCooldown > 0) {
            submitBtn.textContent = `${registerCooldown}秒后再试`;
            submitBtn.disabled = true;
        } else {
            submitBtn.textContent = isRegisterMode ? '注册账号' : '登录';
            submitBtn.disabled = false;
        }
    }
}

function startRegisterCooldown() {
    registerCooldown = 60;
    syncAuthModalUI();
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
        registerCooldown--;
        if (registerCooldown <= 0) {
            clearInterval(cooldownTimer);
            registerCooldown = 0;
        }
        syncAuthModalUI();
    }, 1000);
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    if (!supabaseClient) {
        window.showToast('系统暂不可用，请稍后重试', 'error');
        return;
    }
    if (isRegisterMode && registerCooldown > 0) return;

    const emailInput = document.getElementById('auth-email');
    const pwdInput = document.getElementById('auth-password');
    const submitBtn = document.getElementById('auth-submit-btn');
    const modalBox = document.getElementById('auth-modal-box');

    const email = emailInput.value.trim().toLowerCase();
    const password = pwdInput.value;

    if (!email || password.length < 6) {
        window.showToast('请输入有效邮箱和至少6位密码', 'error');
        shakeElement(modalBox);
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '处理中...';

    try {
        if (isRegisterMode) {
            const domain = email.split('@')[1];
            if (!domain || !ALLOWED_EMAIL_DOMAINS.includes(domain)) {
                window.showToast('邮箱域名不支持，请更换常见邮箱', 'error');
                shakeElement(modalBox);
                return;
            }

            const { error } = await supabaseClient.auth.signUp({ email, password });
            if (error) {
                if (error.message.includes('already registered')) {
                    window.showToast('该邮箱已注册，请直接登录', 'error');
                    isRegisterMode = false;
                } else if (error.message.includes('rate limit')) {
                    window.showToast('发送太频繁，请1小时后再试', 'error');
                } else {
                    window.showToast('注册失败：' + error.message, 'error');
                }
                shakeElement(modalBox);
                return;
            }

            window.showToast('注册成功，请前往邮箱确认验证', 'success');
            startRegisterCooldown();
            document.getElementById('auth-form').reset();
            setTimeout(() => window.closeModalById('auth-modal'), 1200);
        } else {
            const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) {
                if (error.message.includes('Invalid login credentials')) {
                    window.showToast('账号或密码不正确', 'error');
                } else if (error.message.includes('Email not confirmed')) {
                    window.showToast('请先验证邮箱后再登录', 'error');
                } else {
                    window.showToast('登录失败：' + error.message, 'error');
                }
                shakeElement(modalBox);
                return;
            }

            localStorage.setItem('gt_last_email', email);
            window.showToast('登录成功', 'success');
            document.getElementById('auth-form').reset();
            window.closeModalById('auth-modal');
        }
    } catch (err) {
        console.error('认证异常:', err);
        window.showToast('操作失败，请稍后重试', 'error');
    } finally {
        syncAuthModalUI();
    }
}

// ========== 账号中心、修改密码与开通会员 ==========
function openAccountModal() {
    if (!currentProfile) return;
    const isMember = currentProfile.is_member === true;
    document.getElementById('account-email').textContent = currentProfile.email || currentUser?.email || '';
    const statusEl = document.getElementById('account-member-status');
    statusEl.textContent = isMember ? '终身会员' : '未开通';
    statusEl.className = isMember ? 'font-semibold text-amber-400' : 'font-semibold text-gray-300';
    document.getElementById('account-quota').textContent = isMember ? '无限' : '1次';
    document.getElementById('account-upgrade-btn').classList.toggle('hidden', isMember);
    window.openModalById('account-modal');
}

function resetPaymentModal() {
    document.getElementById('payment-step-qr').classList.remove('hidden');
    document.getElementById('payment-step-verify').classList.add('hidden');
    document.getElementById('payment-step-success').classList.add('hidden');
    const input = document.getElementById('order-id-input');
    input.value = '';
    document.getElementById('order-len').textContent = '0';
    document.getElementById('order-error').classList.add('hidden');
    document.getElementById('payment-submit-btn').disabled = true;
    document.querySelectorAll('#order-dots div').forEach(dot => {
        dot.classList.remove('bg-green-400');
        dot.classList.add('bg-gray-700');
    });
}

function openPaymentModal() {
    resetPaymentModal();
    window.openModalById('payment-modal');
}

async function handlePasswordSubmit(e) {
    e.preventDefault();
    const pwd = document.getElementById('new-password-input').value;
    const confirmPwd = document.getElementById('confirm-password-input').value;
    const submitBtn = document.getElementById('password-submit-btn');

    if (pwd.length < 6) {
        window.showToast('密码至少需要6位', 'error');
        return;
    }
    if (pwd !== confirmPwd) {
        window.showToast('两次输入的密码不一致', 'error');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '修改中...';
    try {
        const { error } = await supabaseClient.auth.updateUser({ password: pwd });
        if (error) throw error;
        if (window.location.hash && (window.location.hash.includes('type=recovery') || window.location.hash.includes('access_token'))) {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        window.showToast('密码修改成功', 'success');
        document.getElementById('password-form').reset();
        window.closeModalById('password-modal');
    } catch (err) {
        window.showToast('修改失败：' + err.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '确定修改';
    }
}

async function handleOrderVerify() {
    const input = document.getElementById('order-id-input');
    const errorEl = document.getElementById('order-error');
    const submitBtn = document.getElementById('payment-submit-btn');
    const orderId = input.value.trim();

    const showErr = (msg) => {
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
    };

    errorEl.classList.add('hidden');

    if (!/^\d{32}$/.test(orderId) || orderId.substring(10, 18) !== getTodayCompactDate()) {
        showErr('订单号输入错误，请核对当日 32 位微信支付订单号');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '验证中...';

    try {
        // 查重
        const { data: existingOrder, error: checkError } = await supabaseClient
            .from('GameTogether')
            .select('email, order_id')
            .eq('order_id', orderId)
            .maybeSingle();

        if (checkError) throw checkError;
        if (existingOrder) {
            showErr('该订单号已被使用');
            submitBtn.disabled = false;
            submitBtn.textContent = '提交验证';
            return;
        }

        // 更新会员状态
        const { error: updateError } = await supabaseClient
            .from('GameTogether')
            .update({ is_member: true, order_id: orderId })
            .eq('id', currentProfile.id);

        if (updateError) throw updateError;

        currentProfile.is_member = true;
        updateAuthNavUI();
        document.getElementById('payment-step-verify').classList.add('hidden');
        document.getElementById('payment-step-success').classList.remove('hidden');
        window.showToast('会员开通成功！', 'success');

        setTimeout(() => {
            window.closeModalById('payment-modal');
        }, 2500);
    } catch (err) {
        showErr('验证失败：' + err.message);
        submitBtn.disabled = false;
        submitBtn.textContent = '提交验证';
    }
}

// ========== 对外暴露认证状态与方法 ==========
window.AuthState = {
    get supabase() { return supabaseClient; },
    getUser: () => currentUser,
    getProfile: () => currentProfile,
    openAuthModal: () => {
        isRegisterMode = false;
        syncAuthModalUI();
        const savedEmail = localStorage.getItem('gt_last_email');
        const emailEl = document.getElementById('auth-email');
        if (savedEmail && emailEl && !emailEl.value) emailEl.value = savedEmail;
        window.openModalById('auth-modal');
    },
    openAccountModal,
    openPaymentModal,
    openLimitModal: () => window.openModalById('limit-modal')
};

// ========== 初始化事件绑定 ==========
document.addEventListener('DOMContentLoaded', () => {
    // 渲染 32 位订单号进度点
    const orderDots = document.getElementById('order-dots');
    if (orderDots) {
        orderDots.innerHTML = Array.from({ length: 32 }, () => '<div class="w-1.5 h-1.5 rounded-full bg-gray-700 transition-colors"></div>').join('');
    }

    // 顶部登录/账号按钮
    document.getElementById('nav-auth-btn')?.addEventListener('click', () => {
        if (currentUser && currentProfile) openAccountModal();
        else window.AuthState.openAuthModal();
    });

    // 登录/注册表单
    document.getElementById('auth-form')?.addEventListener('submit', handleAuthSubmit);
    document.getElementById('toggle-auth-mode-btn')?.addEventListener('click', () => {
        isRegisterMode = !isRegisterMode;
        syncAuthModalUI();
    });
    let forgotTargetEmail = '';
    let forgotResendTimer = null;
    const forgotStep1 = document.getElementById('forgot-step1-form');
    const forgotStep2 = document.getElementById('forgot-step2-form');
    const forgotResendBtn = document.getElementById('forgot-resend-btn');

    const startForgotCooldown = () => {
        if (!forgotResendBtn) return;
        let sec = 60;
        clearInterval(forgotResendTimer);
        forgotResendBtn.disabled = true;
        forgotResendBtn.textContent = `${sec}s 后重发`;
        forgotResendTimer = setInterval(() => {
            sec--;
            if (sec <= 0) {
                clearInterval(forgotResendTimer);
                forgotResendBtn.disabled = false;
                forgotResendBtn.textContent = '重新发送';
            } else {
                forgotResendBtn.textContent = `${sec}s 后重发`;
            }
        }, 1000);
    };

    const sendForgotOtp = async (email, btn, origText) => {
        if (!supabaseClient) {
            window.showToast('系统暂不可用，请稍后重试', 'error');
            return false;
        }
        btn.disabled = true;
        btn.textContent = '发送中...';
        try {
            const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + window.location.pathname
            });
            if (error) {
                let msg = error.message;
                if (msg.includes('rate limit') || msg.includes('seconds')) msg = '发送过于频繁，请稍后再试';
                else if (msg.includes('Invalid email')) msg = '邮箱格式不正确';
                window.showToast(msg, 'error');
                return false;
            }
            window.showToast('验证码已发送，请查收邮箱（注意垃圾箱）', 'success');
            return true;
        } catch {
            window.showToast('发送失败，请稍后重试', 'error');
            return false;
        } finally {
            btn.disabled = false;
            btn.textContent = origText;
        }
    };

    document.getElementById('open-forgot-btn')?.addEventListener('click', () => {
        window.closeModalById('auth-modal');
        clearInterval(forgotResendTimer);
        forgotStep1?.classList.remove('hidden');
        forgotStep2?.classList.add('hidden');
        forgotStep1?.reset();
        forgotStep2?.reset();
        window.openModalById('forgot-modal');
    });

    forgotStep1?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('forgot-email-input').value.trim().toLowerCase();
        if (!email) { window.showToast('请输入注册邮箱', 'error'); return; }
        const ok = await sendForgotOtp(email, document.getElementById('forgot-send-btn'), '发送验证码');
        if (ok) {
            forgotTargetEmail = email;
            document.getElementById('forgot-email-display').textContent = email;
            forgotStep1.classList.add('hidden');
            forgotStep2.classList.remove('hidden');
            startForgotCooldown();
            document.getElementById('forgot-code-input')?.focus();
        }
    });

    forgotResendBtn?.addEventListener('click', async () => {
        if (!forgotTargetEmail || forgotResendBtn.disabled) return;
        const ok = await sendForgotOtp(forgotTargetEmail, forgotResendBtn, '重新发送');
        if (ok) startForgotCooldown();
    });

    document.getElementById('forgot-back-btn')?.addEventListener('click', () => {
        clearInterval(forgotResendTimer);
        forgotStep2?.classList.add('hidden');
        forgotStep1?.classList.remove('hidden');
    });

    forgotStep2?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!supabaseClient) { window.showToast('系统暂不可用，请稍后重试', 'error'); return; }
        const token = document.getElementById('forgot-code-input').value.trim();
        const newPwd = document.getElementById('forgot-new-pwd-input').value;
        const confirmPwd = document.getElementById('forgot-confirm-pwd-input').value;
        if (!token) { window.showToast('请输入邮件中的验证码', 'error'); return; }
        if (newPwd.length < 6) { window.showToast('新密码至少需要6位', 'error'); return; }
        if (newPwd !== confirmPwd) { window.showToast('两次输入的密码不一致', 'error'); return; }

        const btn = document.getElementById('forgot-verify-btn');
        btn.disabled = true;
        btn.textContent = '验证中...';
        try {
            const { data, error: verifyErr } = await supabaseClient.auth.verifyOtp({
                email: forgotTargetEmail,
                token,
                type: 'recovery'
            });
            if (verifyErr) {
                let msg = verifyErr.message;
                if (msg.includes('expired') || msg.includes('invalid') || msg.includes('Token')) msg = '验证码无效或已过期，请核对或重新发送';
                window.showToast(msg, 'error');
                return;
            }
            const { error: updateErr } = await supabaseClient.auth.updateUser({ password: newPwd });
            if (updateErr) {
                let msg = updateErr.message;
                if (msg.includes('same as the old password')) msg = '新密码不能与旧密码相同';
                window.showToast('密码修改失败：' + msg, 'error');
                return;
            }
            if (data?.session) await loadUserSession(data.session);
            clearInterval(forgotResendTimer);
            forgotStep1?.reset();
            forgotStep2?.reset();
            window.closeModalById('forgot-modal');
            window.showToast('密码重置成功！已为您自动登录', 'success');
        } catch {
            window.showToast('重置失败，请稍后重试', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '验证并修改密码';
        }
    });
    document.getElementById('copy-admin-wechat-btn')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText('GameTogether1');
        window.showToast('已复制管理员微信', 'success');
    });

    // 账号中心操作
    document.getElementById('account-change-pwd-btn')?.addEventListener('click', () => {
        window.closeModalById('account-modal');
        window.openModalById('password-modal');
    });
    document.getElementById('account-upgrade-btn')?.addEventListener('click', () => {
        window.closeModalById('account-modal');
        openPaymentModal();
    });
    document.getElementById('account-logout-btn')?.addEventListener('click', async () => {
        if (supabaseClient) await supabaseClient.auth.signOut();
        window.closeModalById('account-modal');
        window.showToast('已退出登录', 'info');
    });

    // 修改密码
    document.getElementById('password-form')?.addEventListener('submit', handlePasswordSubmit);

    // 支付弹窗步骤切换与订单号输入
    document.getElementById('payment-paid-btn')?.addEventListener('click', () => {
        document.getElementById('payment-step-qr').classList.add('hidden');
        document.getElementById('payment-step-verify').classList.remove('hidden');
        document.getElementById('order-id-input').focus();
    });
    document.getElementById('payment-back-btn')?.addEventListener('click', () => {
        document.getElementById('payment-step-verify').classList.add('hidden');
        document.getElementById('payment-step-qr').classList.remove('hidden');
    });
    document.getElementById('order-id-input')?.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g, '').slice(0, 32);
        e.target.value = val;
        document.getElementById('order-len').textContent = String(val.length);
        document.getElementById('order-error').classList.add('hidden');
        document.getElementById('payment-submit-btn').disabled = val.length !== 32;
        document.querySelectorAll('#order-dots div').forEach((dot, i) => {
            dot.classList.toggle('bg-green-400', i < val.length);
            dot.classList.toggle('bg-gray-700', i >= val.length);
        });
    });
    document.getElementById('payment-submit-btn')?.addEventListener('click', handleOrderVerify);

    // 下载上限弹窗 -> 开通会员
    document.getElementById('limit-upgrade-btn')?.addEventListener('click', () => {
        window.closeModalById('limit-modal');
        openPaymentModal();
    });

    // 初始化 Supabase 会话监听
    if (supabaseClient) {
        supabaseClient.auth.getSession().then(({ data }) => loadUserSession(data.session));
        supabaseClient.auth.onAuthStateChange(async (event, session) => {
            await loadUserSession(session);
            if (event === 'PASSWORD_RECOVERY') {
                window.openModalById('password-modal');
                window.showToast('验证通过，请设置您的新密码', 'info');
            }
        });
    }
});
