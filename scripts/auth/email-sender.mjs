export function createEmailConfig(env = process.env) {
  return {
    resendApiKey: String(env.RESEND_API_KEY || '').trim(),
    from: String(env.EMAIL_FROM || '').trim(),
    productName: String(env.EMAIL_PRODUCT_NAME || 'Renaiss World Cup').trim(),
  }
}

export function emailSenderConfigured(config) {
  return Boolean(config?.resendApiKey && config?.from)
}

export async function sendOtpEmail(config, { email, code, expiresInSeconds }) {
  if (!emailSenderConfigured(config)) {
    throw Object.assign(new Error('Email OTP sender is not configured.'), { statusCode: 503 })
  }

  const minutes = Math.max(1, Math.floor(Number(expiresInSeconds || 0) / 60))
  const subject = `${config.productName} login code`
  const text = [
    `Your ${config.productName} login code is ${code}.`,
    `It expires in ${minutes} minutes.`,
    'If you did not request this code, you can ignore this email.',
  ].join('\n')

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.resendApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: config.from,
      to: email,
      subject,
      text,
    }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw Object.assign(new Error(payload?.message || `Email provider returned HTTP ${response.status}.`), {
      statusCode: 502,
    })
  }

  return true
}
