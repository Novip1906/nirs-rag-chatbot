<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username'); section>
    <#if section = "header">
        ${msg("emailForgotTitle")}
    <#elseif section = "form">
        <p class="nf-instruction">${msg("emailInstruction")}</p>
        <form id="kc-reset-password-form" class="nf-form" action="${url.loginAction}" method="post">
            <div class="nf-field">
                <input type="text" id="username" name="username" class="nf-input" autofocus value="${(auth.attemptedUsername)!''}" placeholder=" "
                       aria-invalid="<#if messagesPerField.existsError('username')>true</#if>" />
                <label for="username" class="nf-label">
                    <#if !realm.loginWithEmailAllowed>${msg("username")}<#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}<#else>${msg("email")}</#if>
                </label>
            </div>

            <#if messagesPerField.existsError('username')>
                <span class="nf-field-error">${kcSanitize(messagesPerField.get('username'))?no_esc}</span>
            </#if>

            <div class="nf-submit">
                <input class="nf-button" type="submit" value="${msg("doSubmit")}"/>
            </div>
        </form>
        <div class="nf-back-link">
            <a href="${url.loginUrl}">${msg("backToLogin")}</a>
        </div>
    </#if>
</@layout.registrationLayout>
