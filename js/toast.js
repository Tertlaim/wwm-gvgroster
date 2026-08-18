// ============================================================
// TOAST SYSTEM - Non-blocking notifications
// ============================================================

// Toast container
let toastContainer = null;

function createToastContainer() {
    if (toastContainer) return toastContainer;
    
    toastContainer = document.createElement('div');
    toastContainer.id = 'toastContainer';
    document.body.appendChild(toastContainer);
    return toastContainer;
}

function showToast(message, type = 'info', duration = 3000) {
    const container = createToastContainer();
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    // Icons
    const icons = {
        success: '✅',
        warning: '⚠️',
        info: 'ℹ️',
        error: '❌'
    };
    
    // Toast messages can contain user-supplied player names - escape to avoid XSS
    const safeMessage = typeof esc === 'function' ? esc(message) : String(message);
    
    toast.innerHTML = `
        <span style="font-size: 1.2rem;">${icons[type] || 'ℹ️'}</span>
        <span style="flex: 1;">${safeMessage}</span>
        <button class="toast-close">×</button>
    `;
    
    // Add close button functionality
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => {
        removeToast(toast);
    });
    
    container.appendChild(toast);
    
    // Auto dismiss
    if (duration > 0) {
        setTimeout(() => {
            removeToast(toast);
        }, duration);
    }
    
    return toast;
}

function removeToast(toast) {
    toast.style.animation = 'slideOutRight 0.3s ease forwards';
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 300);
}

// Toast shortcuts
function showSuccess(message, duration = 3000) {
    return showToast(message, 'success', duration);
}

function showWarning(message, duration = 3000) {
    return showToast(message, 'warning', duration);
}

function showInfo(message, duration = 3000) {
    return showToast(message, 'info', duration);
}

function showError(message, duration = 3000) {
    return showToast(message, 'error', duration);
}

// Make globally available
window.showToast = showToast;
window.showSuccess = showSuccess;
window.showWarning = showWarning;
window.showInfo = showInfo;
window.showError = showError;

console.log('Toast system loaded');