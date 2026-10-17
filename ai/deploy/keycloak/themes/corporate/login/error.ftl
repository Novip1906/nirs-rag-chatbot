<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=false; section>
    <#if section = "header">
        ${kcSanitize(msg("errorTitle"))?no_esc}
    <#elseif section = "form">
        <p class="nf-instruction">${kcSanitize(message.summary)?no_esc}</p>
        <#if traceId??>
            <p class="nf-trace-id">${msg("traceIdSupportMessage", traceId)}</p>
        </#if>
        <#if !skipLink?? && client?? && client.baseUrl?has_content>
            <div class="nf-back-link">
                <a id="backToApplication" href="${client.baseUrl}">${msg("backToApplication")}</a>
            </div>
        </#if>
    </#if>
</@layout.registrationLayout>
