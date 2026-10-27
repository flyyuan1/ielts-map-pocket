import { createClient } from '@supabase/supabase-js';

function timedFetch(input, init = {}) {
  return fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
}
export function createAccountAuth(config) {
  const url = new URL(config.url);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || !config.publishableKey.startsWith('sb_publishable_')) throw new Error('账号服务配置无效');
  const client = createClient(config.url, config.publishableKey, {
    auth: { storageKey: 'pocket:auth:v2:' + url.hostname, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    global: { fetch: timedFetch },
  });
  const unwrap = result => { if (result.error) throw result.error; return result.data; };
  return {
    client,
    session: async () => unwrap(await client.auth.getSession()).session,
    signIn: async (email, password) => unwrap(await client.auth.signInWithPassword({ email, password })),
    signUp: async (email, password) => unwrap(await client.auth.signUp({ email, password, options: { emailRedirectTo: config.redirectUrl } })),
    recover: async email => unwrap(await client.auth.resetPasswordForEmail(email, { redirectTo: config.redirectUrl })),
    updatePassword: async password => unwrap(await client.auth.updateUser({ password })),
    signOut: async () => unwrap(await client.auth.signOut({ scope: 'local' })),
    subscribe: callback => client.auth.onAuthStateChange((event, session) => {
      setTimeout(() => callback(event, session), 0);
    }).data.subscription,
    async sync(batch, uid) {
      const session = unwrap(await client.auth.getSession()).session;
      if (!session || session.user.id !== uid) {
        const error = new Error('账号会话已改变'); error.code = 'AUTH_ACCOUNT_CHANGED'; throw error;
      }
      // Capture this request's account token. A later sign-in must never retarget an in-flight upload.
      const token = session.access_token;
      const requestClient = createClient(config.url, config.publishableKey, {
        accessToken: async () => token, global: { fetch: timedFetch },
      });
      const result = await requestClient.rpc('pocket_sync_progress', { p_operations: batch.operations, p_view: batch.view });
      return unwrap(result);
    },
  };
}

export function authErrorText(error) {
  const code = error?.code ?? '';
  if (code === 'invalid_credentials') return '邮箱或密码不正确，请重新输入。';
  if (code === 'email_not_confirmed') return '请先打开验证邮件中的链接，确认邮箱后再登录。';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || error?.status === 429) return '请求过于频繁，请稍后重试。验证邮件也可能仍在发送中。';
  if (code === 'email_address_not_authorized') return '当前只支持已授权的项目成员邮箱，请使用你的 Supabase 项目成员邮箱注册。';
  if (code === 'weak_password') return '密码强度不足，请使用至少 8 位、包含字母和数字的密码。';
  if (code === 'user_already_exists') return '此邮箱已有账号，请直接登录或找回密码。';
  if (code === 'signup_disabled') return '暂未开放新账号注册。';
  if (code === 'same_password') return '新密码不能与当前密码相同。';
  if (code === 'email_address_invalid') return '请输入有效的邮箱地址。';
  if (/email|smtp|mail/i.test(error?.message ?? '')) return '邮件暂时无法发送，请检查邮箱是否已授权，或稍后重试。';
  if (/fetch|network|timeout|abort/i.test(error?.message ?? '') || error?.name === 'TimeoutError') return '暂时无法连接账号服务。学习进度仍保存在本机，请稍后重试。';
  return '操作未完成，请稍后重试。本机已有进度不会删除。';
}
