import { PlayCircle } from 'lucide-react';

type VideoItem = {
  id: string;
  title: string;
  description: string;
  youtubeId: string;
};

const videos: VideoItem[] = [
  {
    id: 'kruglyigod',
    title: 'Свежие фрукты, овощи, зелень круглый год. Как устроены современные технологичные теплицы.',
    description:
      'Свежие огурцы и помидоры, перцы с баклажанами и любая зелень от укропа до изысканных салатов. На наших столах это можно встретить в любое время года, включая снежную зиму. И что самое удивительное - многие из этих овощных культур выросли не где-нибудь в теплых странах, а в средней полосе России. И всё это стало возможным благодаря современным тепличным технологиям!',
    youtubeId: '6Y4GuyVUv2c',
  },
  {
    id: 'greenhouse',
    title: 'Вертикальная ферма: обзор фермы будущего | Индустрия 4.0',
    description:
      'Вертикальная ферма: обзор фермы будущего | Индустрия 4.0',
    youtubeId: '7inuzQhdMBI',
  },
  {
    id: 'obyazatelno',
    title: 'Промышленные и фермерские теплицы для круглогодичного использования. Что обязательно надо знать!',
    description:
      'Разбор: Промышленные и фермерские теплицы для круглогодичного использования.',
    youtubeId: '8nW_RFoq6CI',
  },

  {
    id: 'tomatoes-guide',
    title: 'Методичка по выращиванию томатов от А до Я для начинающих',
    description:
      'Подробный практический разбор этапов выращивания томатов: подготовка почвы, уход, полив и управление микроклиматом.',
    youtubeId: 'ioqjSUD1l3w',
  },
  {
    id: 'cucumber-greenhouse',
    title: 'Состояние огурцов в теплице — месяц после первого сбора',
    description:
      'Разбор состояния растений через месяц после первого урожая. Практические советы по влажности, поливу и вентиляции.',
    youtubeId: '_8cxqL1eWlg',
  },
  {
    id: 'tulip-business',
    title: 'Розы от ростка до вашего букета. Как выращивают цветы?',
    description:
      'От чего зависит цена на цветы? Как похвалить розы, чтобы они лучше росли? Что сделать, чтобы букет дольше простоял? Хватит ли энергии теплицы, чтобы осветить целый город? Как отличить хорошую розу от плохой? Съездили в Раменское и посмотрели, как выращивают розы для ваших букетов',
    youtubeId: 'ZVhVnCgnJtM',
  },
];

export default function LearningPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-2rem)]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#164A41] mb-2">Learning Hub</h1>
        <p className="text-gray-600 max-w-2xl">
          Видео-материалы для начинающих фермеров и операторов теплиц. Здесь вы найдёте практические
          советы по выращиванию культур и управлению микроклиматом в теплице.
        </p>
      </div>

      {/* Video grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {videos.map((video) => (
          <div
            key={video.id}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col"
          >
            {/* YouTube embed */}
            <div className="aspect-video bg-black">
              <iframe
                className="w-full h-full"
                src={`https://www.youtube.com/embed/${video.youtubeId}`}
                title={video.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>

            {/* Description */}
            <div className="p-4 flex-1 flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <PlayCircle className="w-5 h-5 text-[#2EB872]" />
                <h2 className="font-semibold text-[#164A41] text-sm md:text-base">{video.title}</h2>
              </div>

              <p className="text-xs md:text-sm text-gray-600 flex-1">{video.description}</p>

              <div className="mt-3 text-[11px] text-gray-400">
                YouTube · Educational greenhouse videos
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
