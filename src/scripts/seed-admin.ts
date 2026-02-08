import { PrismaClient, UserRole } from '@prisma/client'

const prisma = new PrismaClient()

async function seedAdmin() {
  const userId = process.env.ADMIN_USER_ID

  if (!userId) {
    console.error('Error: ADMIN_USER_ID environment variable is required')
    console.log('Usage: ADMIN_USER_ID=<user-id> npm run seed:admin')
    process.exit(1)
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    })

    if (!user) {
      console.error(`Error: User with ID ${userId} not found`)
      process.exit(1)
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { role: UserRole.ADMIN },
      select: { email: true, role: true },
    })

    console.log('Admin role assigned successfully')
    console.log(`User: ${updatedUser.email}`)
    console.log(`Role: ${updatedUser.role}`)
  } catch (error) {
    console.error('Error seeding admin:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

seedAdmin()
