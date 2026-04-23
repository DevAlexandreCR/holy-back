import { ensureHolyversoUser } from '../modules/holyverso/holyversoAccount.service'
import { disconnectFromDatabase } from '../config/db'

async function seedHolyversoUser() {
  try {
    const user = await ensureHolyversoUser()
    console.log('HolyVerso user ready')
    console.log(`id=${user.id}`)
    console.log(`email=${user.email}`)
    console.log(`handle=${user.handle ?? ''}`)
    console.log(`role=${user.role}`)
    console.log(`is_system_managed=${user.isSystemManaged}`)
    console.log(
      `suppress_creator_notifications=${user.suppressCreatorNotifications}`
    )
  } catch (error) {
    console.error('Error seeding HolyVerso user:', error)
    process.exitCode = 1
  } finally {
    await disconnectFromDatabase().catch(() => undefined)
  }
}

void seedHolyversoUser()
