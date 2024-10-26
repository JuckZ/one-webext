import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Logo from '../Logo.vue'

describe('logo Component', () => {
  it('should render', () => {
    const wrapper = mount(Logo)

    expect(wrapper.html()).toBeTruthy()
  })
})
