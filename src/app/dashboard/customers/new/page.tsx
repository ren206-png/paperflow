import { CustomerForm } from '@/components/customers/CustomerForm'

export default function NewCustomerPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">New customer</h1>
      <CustomerForm />
    </div>
  )
}
