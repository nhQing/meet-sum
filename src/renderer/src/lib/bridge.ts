/**
 * window.api chỉ tồn tại khi trang được nạp trong cửa sổ Electron (qua preload script).
 * Nếu mở URL dev bằng Chrome/Edge thì không có cầu nối này -> phải báo rõ cho người dùng
 * thay vì để app crash với "Cannot read properties of undefined".
 */
export const hasBridge = typeof window !== 'undefined' && Boolean((window as unknown as { api?: unknown }).api)
