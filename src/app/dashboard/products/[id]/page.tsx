'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { ProductForm } from '@/components/products/ProductForm'
import type { Product } from '@/types'
import { isUUID } from '@/lib/utils'

export default function EditProductPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const isValidId = isUUID(params.id)

  const { data: product, isLoading } = useQuery({
    queryKey: ['products', params.id],
    enabled: isValidId,
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').eq('id', params.id).single()
      if (error) throw error
      return data as Product
    },
  })

  if (!isValidId) return <p className="text-gray-500">SKU not found.</p>
  if (isLoading) return <p className="text-gray-500">Loading…</p>
  if (!product) return <p className="text-gray-500">SKU not found.</p>

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Edit SKU</h1>
      <ProductForm product={product} />
    </div>
  )
}
