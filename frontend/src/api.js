import { ElMessage } from 'element-plus';

/** 统一 API 封装：携带令牌、解析一致错误格式、401 时登出回登录页 */
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export function getToken() {
  return localStorage.getItem('grid_token') || '';
}

export async function api(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('网络异常，无法连接服务器');
  }
  if (res.status === 401) {
    if (onUnauthorized) onUnauthorized();
    throw new Error('登录已过期，请重新登录');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error && data.error.message) || `请求失败（${res.status}）`);
    err.code = data && data.error && data.error.code;
    throw err;
  }
  return data;
}

/** 页面动作统一调用：成功提示 + 异常提示 */
export async function runAction(fn, successText) {
  try {
    const result = await fn();
    if (successText) ElMessage.success(successText);
    return result;
  } catch (err) {
    ElMessage.error(err.message || '操作失败');
    throw err;
  }
}
