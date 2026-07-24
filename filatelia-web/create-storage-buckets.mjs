/**
 * Create Supabase Storage buckets for Filatelia
 */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase credentials in .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const buckets = [
  {
    name: 'stamps-images',
    public: true,
    fileSizeLimit: 10485760, // 10MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  },
  {
    name: 'stamps-thumbs',
    public: true,
    fileSizeLimit: 5242880, // 5MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  {
    name: 'stamps-backs',
    public: true,
    fileSizeLimit: 10485760, // 10MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
]

console.log('📦 Creating Supabase Storage buckets...\n')

for (const bucket of buckets) {
  try {
    const { data, error } = await supabase.storage.createBucket(bucket.name, {
      public: bucket.public,
      fileSizeLimit: bucket.fileSizeLimit,
      allowedMimeTypes: bucket.allowedMimeTypes,
    })

    if (error) {
      if (error.message.includes('already exists')) {
        console.log(`  ⚠️  Bucket "${bucket.name}" already exists`)
      } else {
        console.error(`  ✗ Error creating "${bucket.name}":`, error.message)
      }
    } else {
      console.log(`  ✓ Bucket "${bucket.name}" created`)
    }
  } catch (e) {
    console.error(`  ✗ Exception creating "${bucket.name}":`, e.message)
  }
}

// Set bucket policies (allow authenticated users to upload)
console.log('\n📦 Setting bucket policies...')

for (const bucketName of ['stamps-images', 'stamps-thumbs', 'stamps-backs']) {
  try {
    // Policy: authenticated users can upload, everyone can read (since buckets are public)
    const { error } = await supabase.rpc('create_storage_policy', {
      bucket_name: bucketName,
      policy_name: `authenticated_upload_${bucketName}`,
      definition: `auth.role() = 'authenticated'`,
    })

    if (error) {
      console.log(`  ⚠️  Policy for "${bucketName}": ${error.message}`)
    } else {
      console.log(`  ✓ Policy set for "${bucketName}"`)
    }
  } catch (e) {
    console.log(`  ⚠️  Policy for "${bucketName}": ${e.message}`)
  }
}

console.log('\n✅ Done!')
console.log('\n📋 Next steps:')
console.log('  1. Go to https://supabase.com/dashboard/project/tshatwvvkworsogjfjyj/storage/buckets')
console.log('  2. Verify the 3 buckets were created')
console.log('  3. Upload test images to verify permissions')
