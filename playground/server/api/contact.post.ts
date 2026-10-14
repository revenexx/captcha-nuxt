/**
 * The contact form's endpoint: the token is verified before anything else
 * happens. A token is valid once; a second submit with it is refused.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ name?: string, message?: string, captcha?: string, action?: string }>(event)
  const action = body?.action === 'newsletter' ? 'newsletter' : 'contact'
  const result = await verifyCaptcha(event, body?.captcha, { action })
  if (!result.success) {
    throw createError({ statusCode: 422, statusMessage: 'Captcha not solved', data: result })
  }
  // … send the message here.
  return { ok: true, captcha: result }
})
