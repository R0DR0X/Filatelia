import { createClient } from '@supabase/supabase-js'

// Supabase config
const supabaseUrl = 'https://tshatwvvkworsogjfjyj.supabase.co'
// We need the service role key for admin operations
// For now, we'll try with anon key and document if it fails
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY

if (!supabaseKey) {
  console.error('Error: SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY not set')
  console.error('Get it from: Supabase Dashboard > Project Settings > API')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const buckets = [
  { name: 'stamps-images', public: true },
  { name: 'stamps-thumbs', public: true },
  { name: 'stamps-backs', public: true }
]

for (const bucket of buckets) {
  try {
    console.log(`Creating bucket: ${bucket.name}...`)
    const { data, error } = await supabase.storage.createBucket(bucket.name, {
      public: bucket.public,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      fileSizeLimit: 10485760 // 10MB
    })

    if (error) {
      if (error.message.includes('already exists')) {
        console.log(`  ✓ Bucket ${bucket.name} already exists`)
      } else {
        console.error(`  ✗ Error: ${error.message}`)
      }
    } else {
      console.log(`  ✓ Bucket ${bucket.name} created successfully`)
    }
  } catch (e) {
    console.error(`  ✗ Exception: ${e.message}`)
  }
}

console.log('\nDone!')
