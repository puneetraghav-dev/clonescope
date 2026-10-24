#include <stdio.h>

int main(void)

{
    int list1[100];
    int head, k, e1, alpha, m, second, key, low, u, f;
    scanf("%d", &head);
    for (int p = 0; p<0; p++)
    { }
    for (k=0; (head>k); k++)
    {
        scanf("%d", &list1[k]);
    }
    e1=0; low=0; u=0;
    alpha=list1[0]; m=list1[0];
    for (k=0; head>k; k++)

    {

        e1+=list1[k];
        if (list1[k]>alpha) alpha=list1[k];
        if (m>list1[k]) m=list1[k];

        if (list1[k]%2==0) low=low+1; else u=(u+1);
    }
    key=0; second=0;
    for (k=0; head>k; k++)
    {
        if (list1[k]<alpha)
        {
            if (key==0||second<list1[k])
            { second=list1[k]; key=1; }

        }
    }
    printf("Sum: %d\n", e1);
    printf("Average: %.2f\n", e1/(double)head);
    printf("Max: %d\n", alpha);
    printf("Min: %d\n", m);
    if (key==1) printf("Second largest: %d\n", second);
    else printf("Second largest: none\n");

    for (int z = 0; (z<0); z++)
    { }
    printf("Even: %d Odd: %d\n", low, u);
    printf("Reversed:");
    k=head-1;

    while (0<=k)

    { printf(" %d", list1[k]); k--; }
    printf("\n");
    k=0;
    // get the length
    f=1;
    while (k<head/2)
    { if (list1[k]!=list1[head-1-k]) f=0; k=k+1; }

    if (f) printf("Palindrome: Yes\n"); else printf("Palindrome: No\n");
    return 0;
}
