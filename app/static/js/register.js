// config.js
const CONSTANTS = {
    // 文件相关配置
    FILE: {
        MAX_SIZE: 5 * 1024 * 1024,
        ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/gif'],
        IMAGE_QUALITY: 0.9,
        OUTPUT_SIZE: {
            width: 200,
            height: 200
        }
    },

    // 安全相关配置
    SECURITY: {
        CSRF_HEADER: 'X-CSRF-Token',
        PASSWORD_MIN_LENGTH: 8,
        MAX_USERNAME_LENGTH: 20,
        EMAIL_REGEX: /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
    },

    // API 相关配置
    API: {
        ENDPOINTS: {
            REGISTER: '/register',
            VALIDATE_EMAIL: '/validate-email',
            SEND_CODE: '/send-verification-code'
        },
        TIMEOUT: 10000,
        RETRY_ATTEMPTS: 3
    },

    // UI相关配置
    UI: {
        ANIMATION_DURATION: 300,
        DEBOUNCE_DELAY: 300,
        COOLDOWN_TIME: 120
    }
};

// 工具函数
const utils = {
    // XSS防护
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    // 防抖函数
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // 错误处理
    handleError(error, defaultMessage = '操作失败') {
        console.error(error);
        return {
            success: false,
            message: error?.message || defaultMessage
        };
    },

    // 安全的获取DOM元素
    getElement(id) {
        const element = document.getElementById(id);
        if (!element) {
            console.warn(`Element with id "${id}" not found`);
        }
        return element;
    },

    // URL安全处理
    createSafeUrl(blob) {
        const url = URL.createObjectURL(blob);
        setTimeout(() => URL.revokeObjectURL(url), 60000); // 60秒后自动释放
        return url;
    }
};

// HTTP请求封装
class HttpClient {
    constructor() {
        this.csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
    }

    async request(url, options = {}) {
        const config = {
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                [CONSTANTS.SECURITY.CSRF_HEADER]: this.csrfToken,
                ...options.headers
            },
            ...options
        };

        try {
            const response = await fetch(url, config);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            return utils.handleError(error);
        }
    }

    // GET请求
    get(url, options = {}) {
        return this.request(url, { ...options, method: 'GET' });
    }

    // POST请求
    post(url, data, options = {}) {
        return this.request(url, {
            ...options,
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
}

export { CONSTANTS, utils, HttpClient };
// formValidator.js
import { CONSTANTS, utils, HttpClient } from './config.js';

class EventManager {
    constructor() {
        this.handlers = new Map();
    }

    on(element, event, handler, options = {}) {
        if (!element) return;

        const wrappedHandler = options.debounce
            ? utils.debounce(handler, options.debounce)
            : handler;

        element.addEventListener(event, wrappedHandler);

        if (!this.handlers.has(element)) {
            this.handlers.set(element, new Map());
        }

        this.handlers.get(element).set(event, {
            original: handler,
            wrapped: wrappedHandler
        });
    }

    off(element, event) {
        if (!element || !this.handlers.has(element)) return;

        const elementHandlers = this.handlers.get(element);

        if (event) {
            const handler = elementHandlers.get(event);
            if (handler) {
                element.removeEventListener(event, handler.wrapped);
                elementHandlers.delete(event);
            }
        } else {
            elementHandlers.forEach((handler, event) => {
                element.removeEventListener(event, handler.wrapped);
            });
            this.handlers.delete(element);
        }
    }

    destroy() {
        this.handlers.forEach((elementHandlers, element) => {
            this.off(element);
        });
        this.handlers.clear();
    }
}

class FormValidator {
    constructor(formId) {
        this.form = utils.getElement(formId);
        this.httpClient = new HttpClient();
        this.eventManager = new EventManager();
        this.fields = this.initializeFields();

        if (this.form) {
            this.init();
        }
    }

    initializeFields() {
        return {
            username: {
                id: 'username',
                errorId: 'username-error',
                validate: this.validateUsername.bind(this)
            },
            email: {
                id: 'email',
                errorId: 'email-error',
                validate: this.validateEmail.bind(this)
            },
            verificationCode: {
                id: 'verification_code',
                errorId: 'code-error',
                validate: this.validateVerificationCode.bind(this)
            },
            password: {
                id: 'password',
                errorId: 'password-error',
                validate: this.validatePassword.bind(this)
            },
            password2: {
                id: 'password2',
                errorId: 'password2-error',
                validate: this.validatePasswordConfirm.bind(this)
            },
            gender: {
                errorId: 'gender-error',
                validate: this.validateGender.bind(this)
            }
        };
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
        // 表单提交事件
        this.eventManager.on(this.form, 'submit', this.handleSubmit.bind(this));

        // 字段验证事件
        Object.keys(this.fields).forEach(fieldName => {
            const field = this.fields[fieldName];
            if (field.id) {
                const element = utils.getElement(field.id);
                if (element) {
                    this.eventManager.on(element, 'blur',
                        () => this.validateField(fieldName),
                        { debounce: CONSTANTS.UI.DEBOUNCE_DELAY }
                    );
                    this.eventManager.on(element, 'input',
                        () => this.clearError(field.errorId)
                    );
                }
            }
        });
    }

    // 字段验证方法
    validateUsername(value) {
        if (!value.trim()) return '请输入用户名';
        if (value.length < 3) return '用户名至少需要3个字符';
        if (value.length > CONSTANTS.SECURITY.MAX_USERNAME_LENGTH) {
            return `用户名不能超过${CONSTANTS.SECURITY.MAX_USERNAME_LENGTH}个字符`;
        }
        return true;
    }

    validateEmail(value) {
        if (!value.trim()) return '请输入邮箱地址';
        if (!CONSTANTS.SECURITY.EMAIL_REGEX.test(value)) {
            return '请输入有效的邮箱地址';
        }
        return true;
    }

    validateVerificationCode(value) {
        if (!value.trim()) return '请输入验证码';
        if (!/^\d{6}$/.test(value)) return '验证码应为6位数字';
        return true;
    }

    validatePassword(value) {
        if (!value) return '请输入密码';
        if (value.length < CONSTANTS.SECURITY.PASSWORD_MIN_LENGTH) {
            return `密码至少需要${CONSTANTS.SECURITY.PASSWORD_MIN_LENGTH}个字符`;
        }
        if (!/(?=.*[A-Za-z])(?=.*\d)/.test(value)) {
            return '密码必须包含字母和数字';
        }
        return true;
    }

    validatePasswordConfirm(value, formData) {
        if (!value) return '请再次输入密码';
        if (value !== formData.password) return '两次输入的密码不一致';
        return true;
    }

    validateGender(value) {
        return value ? true : '请选择性别';
    }

    // 表单验证方法
    validateField(fieldName) {
        const field = this.fields[fieldName];
        const element = field.id ? utils.getElement(field.id) : this.getGenderValue();
        if (!element && fieldName !== 'gender') return false;

        const value = fieldName === 'gender' ? element : element.value;
        const formData = this.getFormData();

        const validationResult = field.validate(value, formData);

        if (validationResult !== true) {
            this.showError(field.errorId, validationResult);
            return false;
        }

        this.clearError(field.errorId);
        return true;
    }

    validateForm() {
        let isValid = true;
        Object.keys(this.fields).forEach(fieldName => {
            if (!this.validateField(fieldName)) {
                isValid = false;
            }
        });
        return isValid;
    }

    // 表单数据处理
    getFormData() {
        const formData = {};
        Object.keys(this.fields).forEach(fieldName => {
            const field = this.fields[fieldName];
            if (fieldName === 'gender') {
                formData[fieldName] = this.getGenderValue();
            } else if (field.id) {
                const element = utils.getElement(field.id);
                if (element) {
                    formData[fieldName] = element.value;
                }
            }
        });
        return formData;
    }

    getGenderValue() {
        const maleRadio = document.querySelector('input[name="gender"][value="male"]');
        const femaleRadio = document.querySelector('input[name="gender"][value="female"]');
        return (maleRadio?.checked ? 'male' : '') || (femaleRadio?.checked ? 'female' : '');
    }

    // UI相关方法
    showError(errorId, message) {
        const errorElement = utils.getElement(errorId);
        if (errorElement) {
            errorElement.textContent = utils.escapeHtml(message);
            errorElement.style.display = 'block';
            errorElement.setAttribute('role', 'alert');
            errorElement.classList.add('error-shake');
            setTimeout(() => errorElement.classList.remove('error-shake'), 500);
        }
    }

    clearError(errorId) {
        const errorElement = utils.getElement(errorId);
        if (errorElement) {
            errorElement.textContent = '';
            errorElement.style.display = 'none';
            errorElement.removeAttribute('role');
        }
    }

    // 表单提交处理
    async handleSubmit(e) {
        e.preventDefault();

        if (!this.validateForm()) {
            return;
        }

        const formData = this.getFormData();

        try {
            const response = await this.httpClient.post(
                CONSTANTS.API.ENDPOINTS.REGISTER,
                formData
            );

            if (response.error) {
                this.showError(
                    this.fields[response.field]?.errorId || 'form-error',
                    response.error
                );
            } else {
                window.location.href = '/registration-success';
            }
        } catch (error) {
            this.showError('form-error', '注册失败，请稍后重试');
        }
    }

    // 资源清理
    destroy() {
        this.eventManager.destroy();
    }
}

export default FormValidator;