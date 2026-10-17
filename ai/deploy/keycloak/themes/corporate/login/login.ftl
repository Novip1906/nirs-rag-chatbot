<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password'); section>
    <#if section = "header">
        ${msg("loginAccountTitle")}
    <#elseif section = "form">
        <form id="kc-form-login" class="nf-form" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post">
            <div class="nf-field">
                <input tabindex="1" id="username" class="nf-input" name="username" value="${(login.username!'')}" type="text"
                       <#if !(login.username!'')?has_content>autofocus</#if> autocomplete="<#if usernameHidden??>off<#else>email</#if>"
                       aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
                       placeholder=" " />
                <label for="username" class="nf-label">
                    <#if !realm.loginWithEmailAllowed>${msg("username")}<#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}<#else>${msg("email")}</#if>
                </label>
            </div>

            <div class="nf-field nf-field-password">
                <input tabindex="2" id="password" class="nf-input" name="password" type="password" autocomplete="current-password" placeholder=" "
                       <#if (login.username!'')?has_content>autofocus</#if>
                       aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>" />
                <label for="password" class="nf-label">${msg("password")}</label>
                <button type="button" class="nf-password-toggle" aria-label="${msg("showPassword")!'Show password'}" onclick="nfTogglePassword(this)">
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

            <#if messagesPerField.existsError('username','password')>
                <span class="nf-field-error">${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}</span>
            </#if>

            <div class="nf-forgot">
                <#if realm.resetPasswordAllowed>
                    <a tabindex="5" href="${url.loginResetCredentialsUrl}">${msg("doForgotPassword")}</a>
                <#else>
                    <span>${msg("forgotPasswordContactAdmin")}</span>
                </#if>
            </div>

            <div class="nf-submit">
                <#if realm.rememberMe>
                    <input type="hidden" name="rememberMe" value="on"/>
                </#if>
                <input type="hidden" id="id-hidden-input" name="credentialId" value="<#if auth?has_content>${auth.selectedCredential!}</#if>"/>
                <input tabindex="4" class="nf-button" name="login" id="kc-login" type="submit" value="${msg("doLogIn")}"/>
            </div>
        </form>
    </#if>
</@layout.registrationLayout>
