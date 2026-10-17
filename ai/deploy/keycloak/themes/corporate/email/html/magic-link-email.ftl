<#import "template.ftl" as layout>
<@layout.emailLayout>
<h1 style="margin:0 0 12px;font-size:22px;font-weight:600;color:#212121;">${msg("magicLinkTitle")}</h1>
<p style="margin:0 0 24px;">${msg("magicLinkIntro")}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td bgcolor="#126e6b" style="mso-padding-alt:12px 24px;border-radius:8px;background-color:#126e6b;">
<a href="${magicLink}" style="display:inline-block;padding:12px 24px;border-radius:8px;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${msg("magicLinkButton")}</a>
</td>
</tr>
</table>
<p style="margin:24px 0 0;font-size:13px;color:#595959;">${msg("magicLinkExpiration")}</p>
<p style="margin:8px 0 0;font-size:13px;color:#595959;">${msg("magicLinkIgnore")}</p>
<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e3e3e3;font-size:12px;color:#595959;">${msg("magicLinkFallback")}<br><a href="${magicLink}" style="color:#126e6b;word-break:break-all;">${magicLink}</a></p>
</@layout.emailLayout>
