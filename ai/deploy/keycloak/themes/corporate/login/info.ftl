<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=false; section>
    <#if section = "header">
        <#if messageHeader??>${kcSanitize(msg("${messageHeader}"))?no_esc}<#else>${message.summary}</#if>
    <#elseif section = "form">
        <#if messageHeader?? || requiredActions??>
            <p class="nf-instruction">${message.summary}<#if requiredActions??><#list requiredActions>: <b><#items as reqActionItem>${kcSanitize(msg("requiredAction.${reqActionItem}"))?no_esc}<#sep>, </#items></b></#list></#if></p>
        </#if>
        <#if !skipLink??>
            <#if pageRedirectUri?has_content>
                <div class="nf-back-link">
                    <a id="backToApplication" href="${pageRedirectUri}">${msg("backToApplication")}</a>
                </div>
            <#elseif actionUri?has_content>
                <div class="nf-back-link">
                    <a href="${actionUri}">${msg("proceedWithAction")}</a>
                </div>
            <#elseif (client.baseUrl)?has_content>
                <div class="nf-back-link">
                    <a id="backToApplication" href="${client.baseUrl}">${msg("backToApplication")}</a>
                </div>
            </#if>
        </#if>
    </#if>
</@layout.registrationLayout>
