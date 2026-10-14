export default defineEventHandler(async (event) => {
  const body = await readBody<{ captcha?: string }>(event)
  return verifyCaptcha(event, body?.captcha, { action: 'contact' })
})
