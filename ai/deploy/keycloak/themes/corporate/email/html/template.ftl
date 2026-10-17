<#macro emailLayout>
<!DOCTYPE html>
<html lang="${locale.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Corporate AI</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f4f4" style="background-color:#f4f4f4;">
<tr>
<td align="center" style="padding:32px 16px;">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:480px;background-color:#ffffff;border:1px solid #e3e3e3;border-radius:12px;">
<tr>
<td style="padding:32px;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.55;color:#212121;">
<div style="margin:0 0 24px;font-size:18px;font-weight:700;color:#126e6b;">Corporate AI</div>
<#nested>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>
</#macro>
