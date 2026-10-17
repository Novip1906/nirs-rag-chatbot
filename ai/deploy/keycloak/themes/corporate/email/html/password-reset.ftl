<#import "template.ftl" as layout>
<@layout.emailLayout>
<h1 style="margin:0 0 12px;font-size:22px;font-weight:600;color:#212121;">${msg("passwordResetTitle")}</h1>
<p style="margin:0 0 24px;">${msg("passwordResetIntro")}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td bgcolor="#126e6b" style="mso-padding-alt:12px 24px;border-radius:8px;background-color:#126e6b;">
<a href="${link}" style="display:inline-block;padding:12px 24px;border-radius:8px;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${msg("passwordResetButton")}</a>
</td>
</tr>
</table>
<p style="margin:24px 0 0;font-size:13px;color:#595959;">${msg("passwordResetExpiration", linkExpirationFormatter(linkExpiration))}</p>
<p style="margin:8px 0 0;font-size:13px;color:#595959;">${msg("passwordResetIgnore")}</p>
<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e3e3e3;font-size:12px;color:#595959;">${msg("passwordResetFallback")}<br><a href="${link}" style="color:#126e6b;word-break:break-all;">${link}</a></p>
</@layout.emailLayout>
