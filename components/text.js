import styles from './text.module.css'
import ReactMarkdown from 'react-markdown'
import gfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { atomDark } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import mention from '../lib/remark-mention'
import sub from '../lib/remark-sub'
import remarkDirective from 'remark-directive'
import { visit } from 'unist-util-visit'
import reactStringReplace from 'react-string-replace'
import React, { useRef, useEffect, useState } from 'react'
import GithubSlugger from 'github-slugger'
import LinkIcon from '../svgs/link.svg'
import Thumb from '../svgs/thumb-up-fill.svg'
import { toString } from 'mdast-util-to-string'
import copy from 'clipboard-copy'
import { IMG_URL_REGEXP } from '../lib/url'
import { extractUrls } from '../lib/md'

function myRemarkPlugin () {
  return (tree) => {
    visit(tree, (node) => {
      if (
        node.type === 'textDirective' ||
        node.type === 'leafDirective'
      ) {
        if (node.name !== 'high') return

        const data = node.data || (node.data = {})
        data.hName = 'mark'
        data.hProperties = {}
      }
    })
  }
}

function Heading ({ h, slugger, noFragments, topLevel, children, node, ...props }) {
  const [copied, setCopied] = useState(false)
  const [id] = useState(noFragments ? undefined : slugger.slug(toString(node).replace(/[^\w\-\s]+/gi, '')))

  const Icon = copied ? Thumb : LinkIcon

  return (
    <div className={styles.heading}>
      {React.createElement(h, { id, ...props }, children)}
      {!noFragments && topLevel &&
        <a className={`${styles.headingLink} ${copied ? styles.copied : ''}`} href={`#${id}`}>
          <Icon
            onClick={() => {
              const location = new URL(window.location)
              location.hash = `${id}`
              copy(location.href)
              setTimeout(() => setCopied(false), 1500)
              setCopied(true)
            }}
            width={18}
            height={18}
            className='fill-grey'
          />
        </a>}
    </div>
  )
}

const CACHE_STATES = {
  IS_LOADING: 'IS_LOADING',
  IS_LOADED: 'IS_LOADED',
  IS_ERROR: 'IS_ERROR'
}

export default function Text ({ topLevel, noFragments, nofollow, children }) {
  // all the reactStringReplace calls are to facilitate search highlighting
  const slugger = new GithubSlugger()

  const HeadingWrapper = (props) => Heading({ topLevel, slugger, noFragments, ...props })

  const imgCache = useRef({})
  const [urlCache, setUrlCache] = useState({})

  useEffect(() => {
    const urls = extractUrls(children)

    urls.forEach((url) => {
      if (IMG_URL_REGEXP.test(url)) {
        setUrlCache((prev) => ({ ...prev, [url]: CACHE_STATES.IS_LOADED }))
      } else {
        const img = new Image()
        imgCache.current[url] = img

        setUrlCache((prev) => ({ ...prev, [url]: CACHE_STATES.IS_LOADING }))

        const callback = (state) => {
          setUrlCache((prev) => ({ ...prev, [url]: state }))
          delete imgCache.current[url]
        }
        img.onload = () => callback(CACHE_STATES.IS_LOADED)
        img.onerror = () => callback(CACHE_STATES.IS_ERROR)
        img.src = url
      }
    })

    return () => {
      Object.values(imgCache.current).forEach((img) => {
        img.onload = null
        img.onerror = null
        img.src = ''
      })
    }
  }, [children])

  return (
    <div className={styles.text}>
      <ReactMarkdown
        components={{
          h1: (props) => HeadingWrapper({ h: topLevel ? 'h1' : 'h3', ...props }),
          h2: (props) => HeadingWrapper({ h: topLevel ? 'h2' : 'h4', ...props }),
          h3: (props) => HeadingWrapper({ h: topLevel ? 'h3' : 'h5', ...props }),
          h4: (props) => HeadingWrapper({ h: topLevel ? 'h4' : 'h6', ...props }),
          h5: (props) => HeadingWrapper({ h: topLevel ? 'h5' : 'h6', ...props }),
          h6: (props) => HeadingWrapper({ h: 'h6', ...props }),
          table: ({ node, ...props }) =>
            <div className='table-responsive'>
              <table className='table table-bordered table-sm' {...props} />
            </div>,
          code ({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            return !inline
              ? (
                <SyntaxHighlighter showLineNumbers style={atomDark} language={match && match[1]} PreTag='div' {...props}>
                  {reactStringReplace(String(children).replace(/\n$/, ''), /:high\[([^\]]+)\]/g, (match, i) => {
                    return match
                  }).join('')}
                </SyntaxHighlighter>
                )
              : (
                <code className={className} style={atomDark} {...props}>
                  {reactStringReplace(String(children), /:high\[([^\]]+)\]/g, (match, i) => {
                    return <mark key={`mark-${match}`}>{match}</mark>
                  })}
                </code>
                )
          },
          a: ({ node, href, children, ...props }) => {
            if (children?.some(e => e?.props?.node?.tagName === 'img')) {
              return <>{children}</>
            }

            if (urlCache[href] === CACHE_STATES.IS_LOADED) {
              return <ZoomableImage topLevel={topLevel} {...props} src={href} />
            }

            // map: fix any highlighted links
            children = children?.map(e =>
              typeof e === 'string'
                ? reactStringReplace(e, /:high\[([^\]]+)\]/g, (match, i) => {
                    return <mark key={`mark-${match}-${i}`}>{match}</mark>
                  })
                : e)

            return (
              /*  eslint-disable-next-line */
              <a
                target='_blank' rel={nofollow ? 'nofollow' : 'noreferrer'}
                href={reactStringReplace(href, /:high%5B([^%5D]+)%5D/g, (match, i) => {
                  return match
                }).join('')} {...props}
              >
                {children}
              </a>
            )
          },
          img: ({ node, ...props }) => <ZoomableImage topLevel={topLevel} {...props} />
        }}
        remarkPlugins={[gfm, mention, sub, remarkDirective, myRemarkPlugin]}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

export function ZoomableImage ({ src, topLevel, ...props }) {
  if (!src) {
    return null
  }

  const defaultMediaStyle = {
    maxHeight: topLevel ? '75vh' : '25vh',
    cursor: 'zoom-in'
  }

  // if image changes we need to update state
  const [mediaStyle, setMediaStyle] = useState(defaultMediaStyle)
  useEffect(() => {
    setMediaStyle(defaultMediaStyle)
  }, [src])

  const handleClick = () => {
    if (mediaStyle.cursor === 'zoom-in') {
      setMediaStyle({
        width: '100%',
        cursor: 'zoom-out'
      })
    } else {
      setMediaStyle(defaultMediaStyle)
    }
  }

  return (
    <img
      className={topLevel ? styles.topLevel : undefined}
      style={mediaStyle}
      src={src}
      onClick={handleClick}
      {...props}
    />
  )
}
