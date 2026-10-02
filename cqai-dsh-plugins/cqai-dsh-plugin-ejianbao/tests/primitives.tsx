import {createElement} from 'react'
export const Button = ({variant: _variant, ...props}: Record<string, unknown>) => createElement('button', props)
export const Input = (props: object) => createElement('input', props)
export const Tag = ({tone: _tone, ...props}: Record<string, unknown>) => createElement('span', props)
