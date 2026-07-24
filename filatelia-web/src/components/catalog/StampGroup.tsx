"use client"

import { motion } from "framer-motion"
import { ReactNode } from "react"

interface StampGroupProps {
  titleEs: string
  titleEn?: string
  year?: number
  children: ReactNode
}

export default function StampGroup({ titleEs, titleEn, year, children }: StampGroupProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="mb-12"
    >
      <div className="catalog-header-box flex justify-between items-center">
        <div>
          <h2 className="text-xl md:text-2xl font-serif">{titleEs}</h2>
          {titleEn && <p className="text-sm opacity-80 italic">{titleEn}</p>}
        </div>
        {year && (
          <span className="text-2xl font-bold font-serif opacity-30">
            {year}
          </span>
        )}
      </div>
      
      <div className="bg-zinc-950/40 p-6 border-x border-b border-moss-green/20 rounded-b-lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {children}
        </div>
      </div>
    </motion.div>
  )
}
