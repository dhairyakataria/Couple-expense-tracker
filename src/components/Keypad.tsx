'use client'

import { Delete } from 'lucide-react'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const

/**
 * An on-screen keypad rather than the native keyboard.
 *
 * The native numeric keyboard on Android takes ~400ms to animate in, covers
 * the type chips, and on iOS zooms the viewport. A fixed pad keeps the whole
 * entry flow visible at once, which is what makes sub-10-second entry possible.
 */
export default function Keypad({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const press = (key: string) => {
    if (navigator.vibrate) navigator.vibrate(8)

    if (key === 'del') {
      onChange(value.slice(0, -1))
      return
    }
    if (key === '.') {
      if (value.includes('.')) return
      onChange(value === '' ? '0.' : `${value}.`)
      return
    }
    // Two decimal places is the most paise can ever need.
    if (value.includes('.') && value.split('.')[1].length >= 2) return
    if (value === '0') {
      onChange(key)
      return
    }
    if (value.replace('.', '').length >= 9) return
    onChange(value + key)
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => press(key)}
          aria-label={key === 'del' ? 'Delete' : key}
          className="flex h-14 items-center justify-center rounded-xl bg-white text-2xl font-medium text-ink-900 transition active:bg-ink-100"
        >
          {key === 'del' ? <Delete className="h-6 w-6 text-ink-500" /> : key}
        </button>
      ))}
    </div>
  )
}
