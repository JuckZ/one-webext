<script setup lang="ts">
import type { Interactable } from '@interactjs/types'
import { useToggle } from '@vueuse/core'
import interact from 'interactjs'

import 'uno.css'

const [show, toggle] = useToggle(false)
const position = { x: 0, y: 0 }
const draggingStatus = {}
function enableResizable(interactable: Interactable) {
  interactable.resizable({
    edges: { top: true, left: true, bottom: true, right: true },
    listeners: {
      move(event) {
        let { x, y } = event.target.dataset

        x = (Number.parseFloat(x) || 0) + event.deltaRect.left
        y = (Number.parseFloat(y) || 0) + event.deltaRect.top

        Object.assign(event.target.style, {
          width: `${event.rect.width}px`,
          height: `${event.rect.height}px`,
          transform: `translate(${x}px, ${y}px)`,
        })

        Object.assign(event.target.dataset, { x, y })
      },
    },
  })
}
function enableDraggable(interactable: Interactable) {
  interactable.draggable({
    origin: 'body',
    inertia: true,
    modifiers: [
      // TODO 边缘吸附，留出10px的操作空间
      interact.modifiers.restrict({
        restriction: 'body',
        // 不会拖动元素到body之外
        elementRect: { top: 0, left: 0, bottom: 1, right: 1 },
      }),
    ],
    listeners: {
      start(event) {
        draggingStatus[event.target.id] = true
      },
      move(event) {
        position.x += event.dx
        position.y += event.dy
        event.target.style.transform = `translate(${position.x}px, ${position.y}px)`
      },
      end(event) {
        // setTimeout 在此处是一种hack方式，用于解决拖动结束后，点击事件会被触发的问题
        setTimeout(() => {
          draggingStatus[event.target.id] = false
        }, 0)
      },
    },
  })
}
function toggleShow(eleId: string) {
  if (!draggingStatus[eleId])
    toggle()
}
onMounted(() => {
  const btn = interact('#float-ball')
  // enableResizable(btn)
  enableDraggable(btn)
})
</script>

<template>
  <div
    id="float-ball"
    class="fixed bottom-0 right-0 z-100 flex touch-none select-none select-none items-end leading-1em font-sans"
  >
    <div
      class="h-min w-max rounded-lg bg-white text-gray-800 shadow"
      p="x-4 y-2"
      m="y-auto r-2 b-5"
      :class="show ? 'display-block' : 'display-none'"
    >
      <h1 class="text-lg">
        Vitesse WebExt
      </h1>
      <SharedSubtitle />
    </div>
    <img
      src="../../../extension/assets/icon.png"
      class="icon-btn m-5 h-10 w-10 flex cursor-pointer rounded-full shadow"
      alt="extension icon"
      @click="toggleShow('float-ball')"
    >
  </div>
</template>
