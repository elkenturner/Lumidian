"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "@/lib/utils"

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex items-center gap-0 border-b border-[rgba(99,102,241,0.22)]",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-[3px] -mb-px transition-all whitespace-nowrap",
        "text-[#64748B] border-transparent hover:text-[#94A3B8] hover:bg-[rgba(255,255,255,0.03)]",
        "data-[state=active]:text-[#818CF8] data-[state=active]:border-[#6366f1] data-[state=active]:bg-[rgba(99,102,241,0.08)]",
        "disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
