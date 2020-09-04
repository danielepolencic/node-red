import { Red, NodeProperties, Node } from 'node-red'
import fetch, { Response } from 'node-fetch'
import { zonedTimeToUtc } from 'date-fns-tz'
import cheerio from 'cheerio'

const EVENTBRITE_URL = 'https://www.eventbriteapi.com/v3'

module.exports = function (RED: Red) {
  function ClassifierNode(this: Node, config: NodeProps) {
    RED.nodes.createNode(this, config)
    const node = this
    const token = config.token
    const eventId = config.eventId
    const organizationId = config.organizationId

    node.on('input', async function (msg, send, done) {
      const inPersonCourses = msg.payload.inPersonCourses as CourseInPerson[]
      const onlineCourses = msg.payload.onlineCourses as CourseOnline[]
      const courses = [...inPersonCourses, ...onlineCourses]
      try {
        const allEventFromEventbrite = await (await getAllEvent({ token, organizationId })).json()
        const originalEvent = (await (await getSingleEvent({ token, eventId })).json()) as EventEventBrite
        const events = (allEventFromEventbrite as ResponseEvents).events.map((it: EventEventBrite) => {
          const $ = cheerio.load(it.description.html || '', { decodeEntities: false })
          return {
            ...it,
            code: $('#code').text() || '',
          }
        })

        // events.forEach((it) => {
        //   if (it.id === eventId) {
        //     return
        //   }
        //   deleteEvent({ token, eventId: it.id })
        // })

        const { added, unchanged } = diff({
          previous: events.map((it) => it.code),
          current: courses.map((it) => it.id),
        })

        const newEvents = await Promise.all(
          added.map(async (courseId) => {
            node.log(`Creating EventBrite event for ${courseId}`)
            const course = courses.find((it) => it.id === courseId)!
            return await createEvent({
              token,
              eventId,
              eventAttributes: getEventAttributes(course, originalEvent),
              ticketAttributes: getTicketAttributes(course, originalEvent),
            })
          }),
        )

        const updatedEvent = await Promise.all(
          unchanged.map(async (courseId) => {
            node.log(`Checking if ${courseId} requires updates`)
            const course = courses.find((it) => it.id === courseId)!
            const referenceEvent = events.find((event) => event.code === courseId)
            if (!referenceEvent) {
              node.log(`Event ${courseId} could not be found in the official list of events.`)
              return
            }

            if (
              !isSameDescription({ code: course.id, description: course.description }, referenceEvent) ||
              !isSameDate(course, referenceEvent)
            ) {
              node.log(`Updating description and starting date for ${courseId}`)
              await updateEvent({
                token,
                eventId: referenceEvent.id,
                attributes: getEventAttributes(course, referenceEvent),
              })
            }

            if (!isSamePrice({ price: course.price }, referenceEvent)) {
              node.log(`Updating ticket price to ${courseId}`)
              await updateTicket({
                token,
                eventId: referenceEvent.id,
                ticketClassId: referenceEvent.ticket_classes[0].id,
                attributes: getTicketAttributes(course, referenceEvent),
              })
            }

            return { id: courseId }
          }),
        )

        send({
          payload: { newEvents, updatedEvent },
        })
      } catch (error) {
        send({
          payload: error,
        })
      }
      done()
    })
  }
  RED.nodes.registerType('eventbrite', ClassifierNode)
}

async function copyEvent({ token, eventId }: { token: string; eventId: string }) {
  return await fetch(`${EVENTBRITE_URL}/events/${eventId}/copy/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

async function deleteEvent({ token, eventId }: { token: string; eventId: string }) {
  return await fetch(`${EVENTBRITE_URL}/events/${eventId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

async function updateEvent({
  token,
  eventId,
  attributes,
}: {
  token: string
  eventId: string
  attributes: EventAttributes
}) {
  return await fetch(`${EVENTBRITE_URL}/events/${eventId}/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(attributes),
  })
}

async function publishEvent({ token, eventId }: { token: string; eventId: string }) {
  return await fetch(`${EVENTBRITE_URL}/events/${eventId}/publish/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

async function getSingleEvent({ token, eventId }: { token: string; eventId: string }) {
  return await fetch(`${EVENTBRITE_URL}/events/${eventId}?expand=ticket_classes,venue`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

async function getAllEvent({ token, organizationId }: { token: string; organizationId: string }) {
  return await fetch(`${EVENTBRITE_URL}/organizations/${organizationId}/events?expand=ticket_classes,venue`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

async function updateTicket({
  token,
  eventId,
  ticketClassId,
  attributes,
}: {
  token: string
  eventId: string
  ticketClassId: string
  attributes: TicketClassAttributes
}) {
  return await fetch(`${EVENTBRITE_URL}/events/${eventId}/ticket_classes/${ticketClassId}/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(attributes),
  })
}

async function createEvent({
  token,
  eventId,
  eventAttributes,
  ticketAttributes,
}: {
  token: string
  eventId: string
  eventAttributes: EventAttributes
  ticketAttributes: TicketClassAttributes
}): Promise<{ published: boolean; id: string }> {
  const copyResponse: CopyResponse = await (await copyEvent({ token, eventId })).json()
  const newEvent = await (await getSingleEvent({ token, eventId: copyResponse.id })).json()
  const updateResponse = await (
    await updateEvent({
      token,
      eventId: newEvent.id,
      attributes: eventAttributes,
    })
  ).json()
  const ticketResponse = await (
    await updateTicket({
      token,
      eventId: newEvent.id,
      ticketClassId: newEvent.ticket_classes[0].id,
      attributes: ticketAttributes,
    })
  ).json()
  const publish = await (await publishEvent({ token, eventId: copyResponse.id })).json()
  return { ...publish, id: newEvent.id, updateResponse, ticketResponse }
}

function isSameDate(a: { startsAt: string; timezone: string }, b: EventEventBrite) {
  return zonedTimeToUtc(a.startsAt, a.timezone).valueOf() === new Date(b.start.utc).valueOf()
}

function isSamePrice(a: { price: number }, b: EventEventBrite) {
  if (b.ticket_classes.length === 0) return false
  return a.price * 100 === b.ticket_classes[0].cost.value
}

function isSameDescription(a: { code: string; description: string }, b: { description: { html: string | null } }) {
  return (
    cheerio.load(renderDescription(a), { decodeEntities: false })('body').text() ===
    cheerio
      .load(b.description.html || '', { decodeEntities: false })('body')
      .text()
  )
}

function renderDescription({ code, description }: { code: string; description: string }) {
  return `${description}<p>Course code: <span id="code">${code}</span></p>`
}

function getEventAttributes(course: CourseInPerson | CourseOnline, event: EventEventBrite): EventAttributes {
  return {
    event: {
      name: {
        html: course.title,
      },
      description: {
        html: renderDescription({ code: course.id, description: course.description }),
      },
      start: {
        timezone: event.start.timezone,
        utc: zonedTimeToUtc(course.startsAt, course.timezone).toISOString().replace('.000Z', 'Z'),
      },
      end: {
        timezone: event.end.timezone,
        utc: zonedTimeToUtc(course.endsAt, course.timezone).toISOString().replace('.000Z', 'Z'),
      },
    },
  }
}

function getTicketAttributes(course: CourseInPerson | CourseOnline, event: EventEventBrite): TicketClassAttributes {
  return {
    ticket_class: {
      cost: `${event.currency},${course.price}00`,
    },
  }
}

function diff({
  previous,
  current,
}: {
  previous: string[]
  current: string[]
}): { removed: string[]; unchanged: string[]; added: string[] }
function diff({
  previous,
  current,
}: {
  previous: number[]
  current: number[]
}): { removed: number[]; unchanged: number[]; added: number[] }
function diff({
  previous,
  current,
}: {
  previous: Array<string | number>
  current: Array<string | number>
}): { removed: Array<string | number>; unchanged: Array<string | number>; added: Array<string | number> } {
  return {
    removed: previous.filter((a) => !current.find((b) => a === b)),
    unchanged: previous.filter((a) => !!current.find((b) => a === b)),
    added: current.filter((b) => !previous.find((a) => a === b)),
  }
}

interface NodeProps extends NodeProperties {
  token: string
  eventId: string
  organizationId: string
}

interface TicketClassAttributes {
  ticket_class: {
    cost: string
  }
}

interface CopyResponse {
  id: string
  end: {
    utc: string
  }
}

interface MultipartText {
  html: string
  text?: string
}

interface CourseOnline {
  id: string
  type: 'online'
  startsAt: string
  endsAt: string
  title: string
  description: string
  priceAsString: string
  price: number
  currency: string
  location: string
  tags: string[]
  timezone: string
  link: string
  url: string
}

interface CourseInPerson {
  id: string
  type: 'in-person'
  startsAt: string
  endsAt: string
  title: string
  description: string
  priceAsString: string
  price: number
  currency: string
  location: string
  address: string
  tags: string[]
  timezone: string
  link: string
  url: string
}

interface EventAttributes {
  event: Partial<EventEventBrite>
}

interface EventEventBrite {
  name: {
    html: string | null
  }
  description: {
    html: string | null
  }
  id: string
  start: {
    timezone: string
    utc: string
  }
  end: {
    timezone: string
    utc: string
  }
  currency: string
  online_event: boolean
  listed: boolean
  shareable: boolean
  ticket_classes: {
    id: string
    cost: {
      value: number
    }
  }[]
  venue_id: string
  code?: string
}

interface ResponseEvents {
  events: EventEventBrite[]
}
