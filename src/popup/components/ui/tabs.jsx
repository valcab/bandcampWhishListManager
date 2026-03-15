import React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../../lib/utils.js";

export function Tabs({ className, ...props }) {
  return <TabsPrimitive.Root className={cn("tabs-root", className)} {...props} />;
}

export function TabsList({ className, ...props }) {
  return <TabsPrimitive.List className={cn("tabs-list", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }) {
  return <TabsPrimitive.Trigger className={cn("tabs-trigger", className)} {...props} />;
}

export function TabsContent({ className, ...props }) {
  return <TabsPrimitive.Content className={cn("tabs-content", className)} {...props} />;
}
