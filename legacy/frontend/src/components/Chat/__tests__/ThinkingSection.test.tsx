import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ThinkingSection from '../ThinkingSection'

describe('ThinkingSection', () => {
  it('renders nothing when thinking is empty', () => {
    const { container } = render(<ThinkingSection thinking="" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders collapsed header with brain icon', () => {
    render(<ThinkingSection thinking="step 1" />)
    expect(screen.getByText('思考过程')).toBeInTheDocument()
    expect(screen.getByText('展开')).toBeInTheDocument()
  })

  it('expands and collapses on click', () => {
    render(<ThinkingSection thinking="step 1" />)
    const button = screen.getByRole('button')
    const content = screen.getByTestId('thinking-content')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(content).toHaveClass('max-h-0', 'opacity-0')

    fireEvent.click(button)
    expect(screen.getByText('step 1')).toBeInTheDocument()
    expect(screen.getByText('收起')).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(content).toHaveClass('max-h-96', 'opacity-100')

    fireEvent.click(button)
    expect(content).toHaveClass('max-h-0', 'opacity-0')
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })
})
