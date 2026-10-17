<#import "template.ftl" as layout>
<@layout.registrationLayout; section>
    <#if section = "header">
        ${msg("logoutConfirmTitle")}
    <#elseif section = "form">
        <p class="nf-instruction">${msg("logoutConfirmHeader")}</p>

        <form id="kc-logout-confirm-form" class="nf-form" action="${url.logoutConfirmAction}" onsubmit="confirmLogout.disabled = true; return true;" method="POST">
            <input type="hidden" name="session_code" value="${logoutConfirm.code}">
            <div class="nf-submit">
                <input class="nf-button" name="confirmLogout" id="kc-logout" type="submit" value="${msg("doLogout")}"/>
            </div>
        </form>

        <#if !logoutConfirm.skipLink && (client.baseUrl)?has_content>
            <div class="nf-back-link">
                <a href="${client.baseUrl}">${msg("backToApplication")}</a>
            </div>
        </#if>
    </#if>
</@layout.registrationLayout>
