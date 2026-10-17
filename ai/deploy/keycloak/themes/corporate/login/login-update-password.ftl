<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('password','password-confirm'); section>
    <#if section = "header">
        ${msg("updatePasswordTitle")}
    <#elseif section = "form">
        <form id="kc-passwd-update-form" class="nf-form" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post">
            <div class="nf-field nf-field-password">
                <input type="password" id="password-new" name="password-new" class="nf-input" autofocus autocomplete="new-password" placeholder=" "
                       aria-invalid="<#if messagesPerField.existsError('password','password-confirm')>true</#if>" />
                <label for="password-new" class="nf-label">${msg("passwordNew")}</label>
                <button type="button" class="nf-password-toggle" aria-label="${msg("showPassword")}" onclick="nfTogglePassword(this)">
                    <svg class="nf-eye-open" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/>
                        <circle cx="12" cy="12" r="3"/>
                    </svg>
                    <svg class="nf-eye-closed" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.6 21.6 0 0 1 5.06-6.06M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a21.6 21.6 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                </button>
            </div>

            <#if messagesPerField.existsError('password')>
                <span class="nf-field-error">${kcSanitize(messagesPerField.get('password'))?no_esc}</span>
            </#if>

            <div class="nf-field nf-field-password">
                <input type="password" id="password-confirm" name="password-confirm" class="nf-input" autocomplete="new-password" placeholder=" "
                       aria-invalid="<#if messagesPerField.existsError('password-confirm')>true</#if>" />
                <label for="password-confirm" class="nf-label">${msg("passwordConfirm")}</label>
                <button type="button" class="nf-password-toggle" aria-label="${msg("showPassword")}" onclick="nfTogglePassword(this)">
                    <svg class="nf-eye-open" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/>
                        <circle cx="12" cy="12" r="3"/>
                    </svg>
                    <svg class="nf-eye-closed" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.6 21.6 0 0 1 5.06-6.06M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a21.6 21.6 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                </button>
            </div>

            <#if messagesPerField.existsError('password-confirm')>
                <span class="nf-field-error">${kcSanitize(messagesPerField.get('password-confirm'))?no_esc}</span>
            </#if>

            <input type="hidden" name="logout-sessions" value="on"/>

            <#if isAppInitiatedAction??>
                <div class="nf-submit-row">
                    <input class="nf-button" type="submit" name="login" value="${msg("doSubmit")}"/>
                    <button class="nf-button nf-button-secondary" type="submit" name="cancel-aia" value="true">${msg("doCancel")}</button>
                </div>
            <#else>
                <div class="nf-submit">
                    <input class="nf-button" type="submit" name="login" value="${msg("doSubmit")}"/>
                </div>
            </#if>
        </form>
    </#if>
</@layout.registrationLayout>
