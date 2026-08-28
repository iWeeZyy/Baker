import { useLocalSearchParams } from 'expo-router';
import { FollowListScreen } from '@/src/FollowListScreen';

export default function FollowersScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  return <FollowListScreen userId={userId} kind="followers" />;
}
