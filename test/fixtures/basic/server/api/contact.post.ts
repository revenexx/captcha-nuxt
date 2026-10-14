export default defineEventHandler(async (event) => {
  const body = await readBody<{ captcha?: string }>(event)
  const result = await verifyCaptcha(event, body?.captcha, { action: 'contact' })
  if (!result.success) setResponseStatus(event, 422)
  return result
})
